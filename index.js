const express = require('express');
const multer = require('multer');
const cors = require('cors');
require('dotenv').config();

const KnowledgeIngestionService = require('./services/KnowledgeIngestionService');
const CoachAIKnowledgeIngestionService = require('./services/CoachAIKnowledgeIngestionService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit (increased for Coach AI)
  }
});

// Simple endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Hello from Express!',
    timestamp: new Date().toISOString(),
    status: 'success'
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Document ingestion endpoint (supports both regular agents and Coach AI)
app.post('/api/ingest-document', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { agentId, companyId, knowledgeType } = req.body;
    
    // Determine if this is for Coach AI or regular agent
    const isCoachAI = knowledgeType === 'coach-ai' || companyId;
    
    if (isCoachAI) {
      // Coach AI knowledge processing
      if (!companyId) {
        return res.status(400).json({
          success: false,
          message: 'Company ID is required for Coach AI knowledge processing'
        });
      }

      console.log(`🤖 Coach AI Knowledge Processing - File: ${req.file.originalname} (${req.file.size} bytes)`);
      console.log(`📊 File type: ${req.file.mimetype}, Company: ${companyId}`);

      const result = await CoachAIKnowledgeIngestionService.ingestDocument(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        companyId
      );

      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } else {
      // Regular agent knowledge processing
      if (!agentId) {
        return res.status(400).json({
          success: false,
          message: 'Agent ID is required for regular agent knowledge processing'
        });
      }

      console.log(`📚 Regular Agent Knowledge Processing - File: ${req.file.originalname} (${req.file.size} bytes)`);
      console.log(`📊 File type: ${req.file.mimetype}, Agent ID: ${agentId}`);

      const result = await KnowledgeIngestionService.ingestDocument(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        agentId
      );

      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    }

  } catch (error) {
    console.error('Document ingestion error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// Get processing stats endpoint (supports both regular agents and Coach AI)
app.get('/api/processing-stats/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.query; // 'agent' or 'coach-ai'
    
    if (type === 'coach-ai') {
      // Coach AI processing stats
      const stats = await CoachAIKnowledgeIngestionService.getProcessingStats(id);
      res.json({
        success: true,
        stats
      });
    } else {
      // Regular agent processing stats
      const stats = await KnowledgeIngestionService.getProcessingStats(id);
      res.json({
        success: true,
        stats
      });
    }
  } catch (error) {
    console.error('Error getting processing stats:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// Delete file chunks endpoint (supports both regular agents and Coach AI)
app.delete('/api/delete-file/:id/:fileHash', async (req, res) => {
  try {
    const { id, fileHash } = req.params;
    const { type } = req.query; // 'agent' or 'coach-ai'
    
    if (type === 'coach-ai') {
      // Coach AI file deletion
      await CoachAIKnowledgeIngestionService.deleteFileChunks(id, fileHash);
      res.json({
        success: true,
        message: 'Coach AI file chunks deleted successfully'
      });
    } else {
      // Regular agent file deletion
      await KnowledgeIngestionService.deleteFileChunks(id, fileHash);
      res.json({
        success: true,
        message: 'File chunks deleted successfully'
      });
    }
  } catch (error) {
    console.error('Error deleting file chunks:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// Coach AI specific endpoints
app.get('/api/coach-ai/processing-stats/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const stats = await CoachAIKnowledgeIngestionService.getProcessingStats(companyId);
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error getting Coach AI processing stats:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

app.delete('/api/coach-ai/delete-file/:companyId/:fileHash', async (req, res) => {
  try {
    const { companyId, fileHash } = req.params;
    await CoachAIKnowledgeIngestionService.deleteFileChunks(companyId, fileHash);
    res.json({
      success: true,
      message: 'Coach AI file chunks deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting Coach AI file chunks:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to see the API`);
});
