// Simple test endpoint to debug Vercel deployment
export default function handler(req, res) {
  try {
    // Test basic functionality
    const testData = {
      message: 'Test endpoint working!',
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      headers: {
        'user-agent': req.headers['user-agent'],
        'content-type': req.headers['content-type']
      },
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        hasSupabaseUrl: !!process.env.SUPABASE_URL,
        hasSupabaseKey: !!process.env.SUPABASE_ANON_KEY,
        hasGeminiKey: !!process.env.GEMINI_API_KEY
      }
    };

    res.status(200).json(testData);
  } catch (error) {
    console.error('Test endpoint error:', error);
    res.status(500).json({
      error: 'Test endpoint failed',
      message: error.message,
      stack: error.stack
    });
  }
}
