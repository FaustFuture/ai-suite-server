// Main index endpoint for Vercel
export default function handler(req, res) {
  res.status(200).json({
    message: 'Hello from Vercel Serverless!',
    timestamp: new Date().toISOString(),
    status: 'success',
    environment: 'serverless'
  });
}
