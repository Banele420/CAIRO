import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { env } from '../_core/env';
import { db } from '../db';
import { messages, conversations } from '../db/schema';
import { eq } from 'drizzle-orm';

interface UserConnection {
  userId: number;
  socket: WebSocket;
  lastPing: number;
}

interface WebSocketMessage {
  type: 'message' | 'typing' | 'read_receipt' | 'presence' | 'ping' | 'error';
  data: any;
  timestamp: number;
}

export class VarsityHubWebSocketServer {
  private wss: WebSocketServer;
  private connections: Map<number, UserConnection> = new Map();
  private pingInterval: NodeJS.Timeout;

  constructor(server: any) {
    this.wss = new WebSocketServer({ server });
    this.setup();
  }

  private setup() {
    this.wss.on('connection', (socket, request) => {
      // Authenticate via token in URL query
      const token = new URL(request.url!, `http://${request.headers.host}`).searchParams.get('token');
      
      if (!token) {
        socket.close(1008, 'Authentication required');
        return;
      }

      let userId: number;
      try {
        const decoded = jwt.verify(token, env.JWT_SECRET) as { id: number };
        userId = decoded.id;
      } catch (error) {
        socket.close(1008, 'Invalid token');
        return;
      }

      // Store connection
      this.connections.set(userId, {
        userId,
        socket,
        lastPing: Date.now(),
      });

      console.log(`User ${userId} connected to WebSocket`);

      // Send welcome message
      this.sendToUser(userId, {
        type: 'presence',
        data: { status: 'connected' },
        timestamp: Date.now(),
      });

      // Notify user's contacts about online status
      this.broadcastToUserContacts(userId, {
        type: 'presence',
        data: { userId, status: 'online' },
        timestamp: Date.now(),
      });

      // Message handler
      socket.on('message', async (data) => {
        try {
          const message: WebSocketMessage = JSON.parse(data.toString());
          await this.handleMessage(userId, message);
        } catch (error) {
          console.error('WebSocket message error:', error);
          this.sendToUser(userId, {
            type: 'error',
            data: { message: 'Invalid message format' },
            timestamp: Date.now(),
          });
        }
      });

      // Ping handler
      socket.on('pong', () => {
        const connection = this.connections.get(userId);
        if (connection) {
          connection.lastPing = Date.now();
        }
      });

      // Close handler
      socket.on('close', () => {
        this.connections.delete(userId);
        console.log(`User ${userId} disconnected`);

        // Notify contacts about offline status
        this.broadcastToUserContacts(userId, {
          type: 'presence',
          data: { userId, status: 'offline' },
          timestamp: Date.now(),
        });
      });

      // Start ping interval
      const pingInterval = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.ping();
        } else {
          clearInterval(pingInterval);
        }
      }, 30000);

      socket.on('close', () => clearInterval(pingInterval));
    });

    // Global ping interval to clean up dead connections
    this.pingInterval = setInterval(() => {
      const now = Date.now();
      for (const [userId, connection] of this.connections.entries()) {
        if (now - connection.lastPing > 60000) {
          connection.socket.terminate();
          this.connections.delete(userId);
        }
      }
    }, 30000);
  }

  private async handleMessage(userId: number, message: WebSocketMessage) {
    switch (message.type) {
      case 'message':
        await this.handleNewMessage(userId, message.data);
        break;

      case 'typing':
        await this.handleTypingIndicator(userId, message.data);
        break;

      case 'read_receipt':
        await this.handleReadReceipt(userId, message.data);
        break;

      case 'ping':
        this.sendToUser(userId, {
          type: 'pong',
          data: {},
          timestamp: Date.now(),
        });
        break;
    }
  }

  private async handleNewMessage(userId: number, data: any) {
    const { conversationId, content, tempId } = data;

    // Verify conversation access
    const conversation = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (!conversation[0]) {
      this.sendToUser(userId, {
        type: 'error',
        data: { tempId, message: 'Conversation not found' },
        timestamp: Date.now(),
      });
      return;
    }

    if (conversation[0].user1Id !== userId && conversation[0].user2Id !== userId) {
      this.sendToUser(userId, {
        type: 'error',
        data: { tempId, message: 'Not a member of this conversation' },
        timestamp: Date.now(),
      });
      return;
    }

    const receiverId = conversation[0].user1Id === userId ? conversation[0].user2Id : conversation[0].user1Id;

    // Save to database
    const message = await db
      .insert(messages)
      .values({
        conversationId,
        senderId: userId,
        content,
        isRead: false,
      })
      .returning();

    // Update conversation last message time
    await db
      .update(conversations)
      .set({ lastMessageAt: new Date() })
      .where(eq(conversations.id, conversationId));

    // Confirm to sender
    this.sendToUser(userId, {
      type: 'message_sent',
      data: { tempId, message: message[0] },
      timestamp: Date.now(),
    });

    // Send to receiver if online
    this.sendToUser(receiverId, {
      type: 'new_message',
      data: { message: message[0], conversationId },
      timestamp: Date.now(),
    });
  }

  private async handleTypingIndicator(userId: number, data: any) {
    const { conversationId, isTyping } = data;

    const conversation = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (!conversation[0]) return;

    const receiverId = conversation[0].user1Id === userId ? conversation[0].user2Id : conversation[0].user1Id;

    this.sendToUser(receiverId, {
      type: 'typing',
      data: { conversationId, userId, isTyping },
      timestamp: Date.now(),
    });
  }

  private async handleReadReceipt(userId: number, data: any) {
    const { messageId } = data;

    await db
      .update(messages)
      .set({ isRead: true, readAt: new Date() })
      .where(eq(messages.id, messageId));

    // Get message to find sender
    const message = await db
      .select({ senderId: messages.senderId, conversationId: messages.conversationId })
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1);

    if (message[0] && message[0].senderId !== userId) {
      this.sendToUser(message[0].senderId, {
        type: 'read_receipt',
        data: { messageId },
        timestamp: Date.now(),
      });
    }
  }

  private sendToUser(userId: number, message: WebSocketMessage) {
    const connection = this.connections.get(userId);
    if (connection && connection.socket.readyState === WebSocket.OPEN) {
      connection.socket.send(JSON.stringify(message));
    }
  }

  private async broadcastToUserContacts(userId: number, message: WebSocketMessage) {
    // Get all conversations for this user
    const userConversations = await db
      .select()
      .from(conversations)
      .where(
        or(
          eq(conversations.user1Id, userId),
          eq(conversations.user2Id, userId)
        )
      );

    const contactIds = userConversations.map(conv => 
      conv.user1Id === userId ? conv.user2Id : conv.user1Id
    );

    // Send to each online contact
    for (const contactId of contactIds) {
      this.sendToUser(contactId, message);
    }
  }

  public broadcastToAll(message: WebSocketMessage) {
    for (const connection of this.connections.values()) {
      if (connection.socket.readyState === WebSocket.OPEN) {
        connection.socket.send(JSON.stringify(message));
      }
    }
  }

  public close() {
    clearInterval(this.pingInterval);
    this.wss.close();
  }
}