# Vercel Serverless Deployment Guide

This guide explains how to deploy your backend as serverless functions on Vercel.

## 🚀 Performance Considerations

### **Advantages of Serverless:**
- ✅ **Auto-scaling**: Handles traffic spikes automatically
- ✅ **Pay-per-use**: Only pay for actual usage
- ✅ **Global CDN**: Fast response times worldwide
- ✅ **Zero maintenance**: No server management needed

### **Performance Optimizations:**
- ✅ **Cold start optimization**: Functions are optimized for quick startup
- ✅ **Connection pooling**: Supabase connections are reused
- ✅ **Memory limits**: 10MB file upload limit (Vercel Pro: 50MB)
- ✅ **Timeout limits**: 60s for file processing, 30s for responses

## 📁 Project Structure

```
backend/
├── api/                          # Vercel serverless functions
│   ├── index.js                  # Main endpoint
│   ├── health.js                 # Health check
│   ├── ingest-document.js        # File upload & processing
│   ├── generate-response.js      # AI response generation
│   ├── processing-stats/
│   │   └── [agentId].js         # Get processing stats
│   └── delete-file/
│       └── [agentId]/
│           └── [fileHash].js     # Delete file chunks
├── services/
│   └── KnowledgeIngestionService.js  # Core business logic
├── vercel.json                   # Vercel configuration
├── package.json                  # Dependencies
└── .env.local                    # Environment variables
```

## 🔧 Deployment Steps

### 1. **Install Vercel CLI**
```bash
npm i -g vercel
```

### 2. **Login to Vercel**
```bash
vercel login
```

### 3. **Deploy from Backend Directory**
```bash
cd backend
vercel
```

### 4. **Set Environment Variables**
In Vercel dashboard or CLI:
```bash
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY
vercel env add GEMINI_API_KEY
```

### 5. **Redeploy with Environment Variables**
```bash
vercel --prod
```

## 🌐 Frontend Configuration

Update your frontend to use the Vercel deployment URL:

```env
# In ai-agents/.env.local
NEXT_PUBLIC_BACKEND_URL=https://your-project.vercel.app
```

## 📊 Performance Monitoring

### **Vercel Analytics:**
- Function execution time
- Cold start frequency
- Error rates
- Memory usage

### **Optimization Tips:**
1. **Keep functions warm**: Use cron jobs or monitoring
2. **Optimize imports**: Use dynamic imports for heavy libraries
3. **Cache responses**: Implement caching for repeated requests
4. **Monitor memory**: Watch for memory leaks in long-running functions

## 🔄 Local Development

For local development, you can still use the Express server:

```bash
cd backend
npm run dev
```

Or test serverless functions locally:

```bash
vercel dev
```

## 🚨 Limitations & Considerations

### **Vercel Free Tier:**
- 100GB bandwidth/month
- 1000 serverless function invocations/day
- 10s execution time limit
- 50MB memory limit

### **Vercel Pro Tier:**
- Unlimited bandwidth
- Unlimited function invocations
- 60s execution time limit
- 1024MB memory limit
- 50MB file upload limit

### **File Processing:**
- Large files may hit timeout limits
- Consider chunking for very large documents
- PDF processing is optimized for serverless

## 🔍 Troubleshooting

### **Common Issues:**
1. **Cold starts**: First request may be slower
2. **Memory limits**: Large files may cause issues
3. **Timeout errors**: Long processing may hit limits
4. **Import errors**: Ensure ES modules are properly configured

### **Debug Commands:**
```bash
# Check function logs
vercel logs

# Test locally
vercel dev

# Check deployment status
vercel ls
```
