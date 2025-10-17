import express from 'express';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import { KnowledgeIngestionService } from './services/KnowledgeIngestionService.js';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config(); // Fallback to .env if .env.local doesn't exist

// Validate required environment variables
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'GEMINI_API_KEY'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingEnvVars.forEach(envVar => {
    console.error(`   - ${envVar}`);
  });
  console.error('\n📝 Please create a .env file in the backend directory with the required variables.');
  console.error('📋 See .env.example for reference.');
  process.exit(1);
}

console.log('✅ Environment variables loaded successfully');

const app = express();
const PORT = process.env.PORT || 3099;

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

// Generate response endpoint
app.post('/api/generate-response', async (req, res) => {
  try {
    const { formId, responses, systemPrompt, examples } = req.body;

    if (!formId || !responses || !systemPrompt) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: formId, responses, and systemPrompt'
      });
    }

    // Get Gemini API key
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        message: 'Gemini API key not configured'
      });
    }

    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    // Prepare the prompt by combining system prompt with user responses
    const userInput = Object.entries(responses)
      .map(([fieldId, value]) => `${fieldId}: ${value}`)
      .join('\n');

    // Retrieve relevant knowledge chunks using similarity search
    let relevantKnowledge = '';
    try {
      console.log('🔍 Retrieving relevant knowledge...');
      const knowledgeChunks = await KnowledgeIngestionService.getRelevantKnowledge(formId, userInput);
      if (knowledgeChunks && knowledgeChunks.length > 0) {
        relevantKnowledge = knowledgeChunks
          .map(chunk => chunk.content)
          .join('\n\n');
        console.log(`📚 Found ${knowledgeChunks.length} relevant knowledge chunks`);
      }
    } catch (error) {
      console.error('Error retrieving knowledge:', error);
      // Continue without knowledge if retrieval fails
    }

    // Build the complete prompt
    let prompt = systemPrompt + '\n\n';
    
    if (relevantKnowledge) {
      prompt += 'Relevant Knowledge:\n' + relevantKnowledge + '\n\n';
    }
    
    if (examples && examples.length > 0) {
      prompt += 'Examples:\n';
      examples.forEach((example, index) => {
        prompt += `${index + 1}. ${example}\n`;
      });
      prompt += '\n';
    }
    
    prompt += 'User Input:\n' + userInput;

    console.log('🤖 Generating response with Gemini...');
    const result = await model.generateContent(prompt);
    const response = result.response;
    const generatedText = response.text();

    res.json({
      success: true,
      response: generatedText
    });

  } catch (error) {
    console.error('Error generating response:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate response'
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to see the API`);
});
