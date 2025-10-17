import { KnowledgeIngestionService } from '../services/KnowledgeIngestionService.js';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed'
    });
  }

  try {
    // For now, return a simple response to test deployment
    res.status(200).json({
      success: true,
      message: 'Document ingestion endpoint is working',
      timestamp: new Date().toISOString(),
      environment: {
        hasSupabaseUrl: !!process.env.SUPABASE_URL,
        hasSupabaseKey: !!process.env.SUPABASE_ANON_KEY,
        hasGeminiKey: !!process.env.GEMINI_API_KEY
      }
    });

    // TODO: Implement file upload handling
    // The multer approach needs to be adapted for Vercel serverless functions

  } catch (error) {
    console.error('Document ingestion error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};
