# VarsityHub - University Super App

A comprehensive digital campus ecosystem for students, built with modern technologies.

## Features

### 🛒 Marketplace
- Student-to-student buying and selling
- Verified sellers with ratings
- Category-based filtering and search
- Campus delivery options
- Real-time messaging between buyers and sellers

### 💬 Real-time Messaging
- WebSocket-based instant messaging
- Typing indicators and read receipts
- File sharing support
- Conversation history

### 📅 Campus Events
- Event creation and promotion
- RSVP system with capacity management
- Calendar integration
- Location-based event discovery

### 📚 Study Hub
- Study group formation
- Resource sharing (notes, past papers)
- Collaborative document editing
- Course-specific discussions

### 💼 Career Zone
- Job and internship listings
- CV template downloads
- Application tracking
- Career workshops and events

### 🎵 Music & Creative
- Student artist profiles
- Music service marketplace (DJ, lessons, production)
- Event promotion for musicians

### 🗺️ Campus Navigation
- Interactive campus maps
- Building information and directions
- Event location pins

### 🔍 Lost & Found
- Item reporting and claiming
- Photo uploads
- Location-based matching

## Tech Stack

### Backend
- **Node.js** with TypeScript
- **tRPC** for type-safe APIs
- **PostgreSQL** with Drizzle ORM
- **Redis** for caching and rate limiting
- **WebSocket** for real-time features
- **JWT** for authentication

### Frontend
- **Next.js 14** with App Router
- **React** with TypeScript
- **Tailwind CSS** for styling
- **ShadCN** UI components
- **TanStack Query** for data fetching
- **Recharts** for data visualization

### Infrastructure
- **Docker** for containerization
- **NGINX** for reverse proxy
- **Paystack** for payments
- **Google Maps API** for maps

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 15+
- Redis 7+
- Docker (optional)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/your-org/varsityhub.git
cd varsityhub