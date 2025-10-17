import { GoogleGenerativeAI } from '@google/generative-ai';
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

    res.status(200).json({
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
}
