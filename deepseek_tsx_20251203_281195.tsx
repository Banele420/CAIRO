'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Store, Upload, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { trpc } from '@/lib/trpc';

const businessCategories = [
  'Food & Drinks',
  'Clothing & Fashion',
  'Electronics',
  'Books & Stationery',
  'Services',
  'Beauty & Personal Care',
  'Health & Wellness',
  'Transport',
  'Entertainment',
  'Other',
];

const businessTypes = [
  'Cafeteria/Restaurant',
  'Retail Store',
  'Service Provider',
  'Freelancer',
  'Tutor',
  'Artist/Musician',
  'Delivery Service',
  'Event Organizer',
  'Other',
];

export default function MerchantRegistration() {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    businessName: '',
    businessType: '',
    category: '',
    address: '',
    phone: '',
    email: '',
    website: '',
    description: '',
    transactionFeePercentage: '1.00',
  });

  const registerMerchant = trpc.wallet.registerMerchant.useMutation();

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        toast({
          title: 'File too large',
          description: 'Logo must be less than 5MB',
          variant: 'destructive',
        });
        return;
      }

      if (!file.type.startsWith('image/')) {
        toast({
          title: 'Invalid file type',
          description: 'Please upload an image file',
          variant: 'destructive',
        });
        return;
      }

      setLogoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    if (step === 1) {
      if (!formData.businessName || !formData.businessType || !formData.category) {
        toast({
          title: 'Missing Information',
          description: 'Please fill in all required fields',
          variant: 'destructive',
        });
        return;
      }
      setStep(2);
      return;
    }

    setIsSubmitting(true);
    try {
      // Upload logo if exists
      let logoUrl = '';
      if (logoFile) {
        // In production, upload to cloud storage
        const formData = new FormData();
        formData.append('file', logoFile);
        // const uploadResponse = await fetch('/api/upload', { method: 'POST', body: formData });
        // logoUrl = await uploadResponse.json().then(data => data.url);
        logoUrl = logoPreview; // Use preview for now
      }

      await registerMerchant.mutateAsync({
        ...formData,
        logoUrl,
        transactionFeePercentage: parseFloat(formData.transactionFeePercentage),
      });

      toast({
        title: 'Registration Successful',
        description: 'Your merchant account is under review',
      });

      router.push('/merchant/dashboard');
    } catch (error: any) {
      toast({
        title: 'Registration Failed',
        description: error.message || 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container max-w-4xl py-8">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-2">Become a Campus Merchant</h1>
        <p className="text-gray-600">
          Accept VarsityHub Wallet payments and grow your campus business
        </p>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center justify-center mb-8">
        <div className="flex items-center">
          <div className={`h-10 w-10 rounded-full flex items-center justify-center ${step >= 1 ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
            {step > 1 ? <CheckCircle className="h-6 w-6" /> : '1'}
          </div>
          <div className={`h-1 w-20 ${step >= 2 ? 'bg-blue-600' : 'bg-gray-200'}`} />
          <div className={`h-10 w-10 rounded-full flex items-center justify-center ${step >= 2 ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
            {step > 2 ? <CheckCircle className="h-6 w-6" /> : '2'}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {step === 1 ? 'Business Information' : 'Additional Details'}
          </CardTitle>
          <CardDescription>
            {step === 1 ? 'Tell us about your business' : 'Add your contact and payment details'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 1 ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="businessName">Business Name *</Label>
                <Input
                  id="businessName"
                  placeholder="e.g., Campus Coffee Shop"
                  value={formData.businessName}
                  onChange={(e) => handleInputChange('businessName', e.target.value)}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="businessType">Business Type *</Label>
                  <Select
                    value={formData.businessType}
                    onValueChange={(v) => handleInputChange('businessType', v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {businessTypes.map((type) => (
                        <SelectItem key={type} value={type}>{type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="category">Category *</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(v) => handleInputChange('category', v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {businessCategories.map((category) => (
                        <SelectItem key={category} value={category}>{category}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Business Description</Label>
                <Textarea
                  id="description"
                  placeholder="Describe what you do, your products/services, etc."
                  value={formData.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  rows={4}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-4">
                <div>
                  <Label className="block mb-2">Business Logo</Label>
                  <div className="flex items-center gap-4">
                    {logoPreview ? (
                      <>
                        <img
                          src={logoPreview}
                          alt="Logo preview"
                          className="h-20 w-20 rounded-lg object-cover"
                        />
                        <Button
                          variant="outline"
                          onClick={() => {
                            setLogoFile(null);
                            setLogoPreview('');
                          }}
                        >
                          Change
                        </Button>
                      </>
                    ) : (
                      <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                          <Upload className="h-8 w-8 text-gray-400 mb-2" />
                          <p className="text-sm text-gray-500">Upload logo (max 5MB)</p>
                        </div>
                        <input
                          type="file"
                          className="hidden"
                          accept="image/*"
                          onChange={handleLogoUpload}
                        />
                      </label>
                    )}
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="address">Campus Address</Label>
                    <Input
                      id="address"
                      placeholder="e.g., Main Campus, Building A"
                      value={formData.address}
                      onChange={(e) => handleInputChange('address', e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone Number</Label>
                    <Input
                      id="phone"
                      placeholder="+27 12 345 6789"
                      value={formData.phone}
                      onChange={(e) => handleInputChange('phone', e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="business@example.com"
                      value={formData.email}
                      onChange={(e) => handleInputChange('email', e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="website">Website (optional)</Label>
                    <Input
                      id="website"
                      placeholder="https://example.com"
                      value={formData.website}
                      onChange={(e) => handleInputChange('website', e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="transactionFeePercentage">
                    Transaction Fee Percentage
                    <span className="text-gray-500 ml-2">(Default: 1%)</span>
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="transactionFeePercentage"
                      type="number"
                      min="0.5"
                      max="5"
                      step="0.1"
                      value={formData.transactionFeePercentage}
                      onChange={(e) => handleInputChange('transactionFeePercentage', e.target.value)}
                      className="w-32"
                    />
                    <span className="text-gray-600">% per transaction</span>
                  </div>
                  <p className="text-sm text-gray-500">
                    This fee is deducted from each payment you receive
                  </p>
                </div>
              </div>

              {/* Terms and Conditions */}
              <div className="border rounded-lg p-4 bg-gray-50">
                <h4 className="font-semibold mb-2">Terms & Conditions</h4>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• You must be a registered student or staff member</li>
                  <li>• All transactions are subject to 1% platform fee</li>
                  <li>• Settlement to your bank account occurs weekly</li>
                  <li>• You must comply with campus business regulations</li>
                  <li>• Fraudulent activity will result in account suspension</li>
                </ul>
              </div>
            </div>
          )}

          <div className="flex justify-between mt-8">
            {step === 2 && (
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
            )}
            <Button
              className={step === 1 ? 'ml-auto' : ''}
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Processing...' : step === 1 ? 'Continue' : 'Complete Registration'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Benefits Card */}
      <Card className="mt-6 bg-gradient-to-r from-blue-50 to-purple-50">
        <CardContent className="pt-6">
          <div className="grid md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-3">
                <Store className="h-6 w-6 text-blue-600" />
              </div>
              <h4 className="font-semibold mb-1">Accept Digital Payments</h4>
              <p className="text-sm text-gray-600">Get paid instantly via wallet</p>
            </div>
            <div className="text-center">
              <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
              <h4 className="font-semibold mb-1">Low Fees</h4>
              <p className="text-sm text-gray-600">Only 1% transaction fee</p>
            </div>
            <div className="text-center">
              <div className="h-12 w-12 rounded-full bg-purple-100 flex items-center justify-center mx-auto mb-3">
                <Upload className="h-6 w-6 text-purple-600" />
              </div>
              <h4 className="font-semibold mb-1">Weekly Settlement</h4>
              <p className="text-sm text-gray-600">Money sent to your bank weekly</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}