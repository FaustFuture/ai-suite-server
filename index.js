const express = require('express');
const multer = require('multer');
const cors = require('cors');
require('dotenv').config();

const KnowledgeIngestionService = require('./services/KnowledgeIngestionService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
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

// Document ingestion endpoint
app.post('/api/ingest-document', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { agentId } = req.body;
    if (!agentId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID is required'
      });
    }

    console.log(`Processing file: ${req.file.originalname} (${req.file.size} bytes)`);
    console.log(`File type: ${req.file.mimetype}`);
    console.log(`Agent ID: ${agentId}`);

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

  } catch (error) {
    console.error('Document ingestion error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// Get processing stats endpoint
app.get('/api/processing-stats/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    const stats = await KnowledgeIngestionService.getProcessingStats(agentId);
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error getting processing stats:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// Delete file chunks endpoint
app.delete('/api/delete-file/:agentId/:fileHash', async (req, res) => {
  try {
    const { agentId, fileHash } = req.params;
    await KnowledgeIngestionService.deleteFileChunks(agentId, fileHash);
    res.json({
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
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to see the API`);
});
