import { KnowledgeIngestionService } from '../../../services/KnowledgeIngestionService.js';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'DELETE') {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed'
    });
  }

  try {
    const { agentId, fileHash } = req.query;
    
    if (!agentId || !fileHash) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID and file hash are required'
      });
    }

    await KnowledgeIngestionService.deleteFileChunks(agentId, fileHash);
    res.status(200).json({
      success: true,
      message: 'File chunks deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting file chunks:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
}
