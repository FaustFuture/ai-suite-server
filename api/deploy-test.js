// Deployment test endpoint to verify everything is working
export default function handler(req, res) {
  try {
    const testResults = {
      status: 'success',
      message: 'Deployment test passed!',
      timestamp: new Date().toISOString(),
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        vercelRegion: process.env.VERCEL_REGION || 'unknown',
        environment: process.env.NODE_ENV || 'production'
      },
      environmentVariables: {
        supabaseUrl: process.env.SUPABASE_URL ? '✅ Set' : '❌ Missing',
        supabaseKey: process.env.SUPABASE_ANON_KEY ? '✅ Set' : '❌ Missing',
        geminiKey: process.env.GEMINI_API_KEY ? '✅ Set' : '❌ Missing'
      },
      request: {
        method: req.method,
        url: req.url,
        headers: {
          'user-agent': req.headers['user-agent'],
          'content-type': req.headers['content-type']
        }
      }
    };

    res.status(200).json(testResults);
  } catch (error) {
    console.error('Deploy test error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Deployment test failed',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
