const express = require('express');
const axios = require('axios');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();
const app = express();

// Cấu hình CORS
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Config các API endpoints
const API_CONFIGS = {
  'tx': {
    path: '/api/tx',
    target: 'https://phanmemcongnghe.fun/',
    apiParam: 'lc79_hu'
  },
  'md5': {
    path: '/api/md5',
    target: 'https://phanmemcongnghe.fun/',
    apiParam: 'lc79_md5'
  }
};

// Hàm tạo headers proxy
function createProxyHeaders(req) {
  return {
    'Host': 'phanmemcongnghe.fun',
    'Origin': 'https://phanmemcongnghe.fun/',
    'Referer': 'https://phanmemcongnghe.fun/',
    'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': req.headers['accept'] || 'application/json, text/plain, */*',
    'Accept-Language': req.headers['accept-language'] || 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': req.headers['accept-encoding'] || 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin'
  };
}

// Hàm xử lý proxy chung
async function handleProxyRequest(req, res, apiConfig) {
  try {
    const { target, apiParam } = apiConfig;
    
    // Lấy tất cả query parameters
    const params = { ...req.query };
    
    // Đảm bảo có param 'api' đúng
    params.api = apiParam;
    
    // Tạo headers
    const headers = createProxyHeaders(req);
    
    // Thêm Authorization nếu có
    if (req.headers.authorization) {
      headers['Authorization'] = req.headers.authorization;
    }

    console.log(`[${apiParam}] Proxying to: ${target}`);
    console.log(`[${apiParam}] Params:`, params);

    // Gọi API
    const response = await axios.get(target, {
      params: params,
      headers: headers,
      timeout: parseInt(process.env.API_TIMEOUT) || 30000
    });

    // Trả về response
    res.status(response.status).json(response.data);
    
  } catch (error) {
    handleAxiosError(error, res, apiConfig.apiParam);
  }
}

// Hàm xử lý lỗi
function handleAxiosError(error, res, apiName) {
  console.error(`[${apiName}] Proxy error:`, error.message);
  
  if (error.response) {
    res.status(error.response.status).json({
      error: true,
      api: apiName,
      message: error.response.data?.message || 'API Error',
      status: error.response.status
    });
  } else if (error.request) {
    res.status(504).json({
      error: true,
      api: apiName,
      message: 'Gateway Timeout - No response from target API',
      code: 'PROXY_TIMEOUT'
    });
  } else {
    res.status(500).json({
      error: true,
      api: apiName,
      message: error.message,
      code: 'PROXY_ERROR'
    });
  }
}

// Tạo tự động các routes từ config
Object.values(API_CONFIGS).forEach(config => {
  // GET requests
  app.get(config.path, (req, res) => {
    handleProxyRequest(req, res, config);
  });
  
  // POST requests
  app.post(config.path, async (req, res) => {
    try {
      const { target, apiParam } = config;
      
      const headers = createProxyHeaders(req);
      headers['Content-Type'] = req.headers['content-type'] || 'application/json';
      
      if (req.headers.authorization) {
        headers['Authorization'] = req.headers.authorization;
      }

      // Kết hợp params từ query string và body
      const params = { ...req.query, api: apiParam };
      
      const response = await axios.post(target, req.body, {
        params: params,
        headers: headers,
        timeout: parseInt(process.env.API_TIMEOUT) || 30000
      });

      res.status(response.status).json(response.data);
      
    } catch (error) {
      handleAxiosError(error, res, apiParam);
    }
  });
});

// Dynamic endpoint
app.get('/api/:type', (req, res) => {
  const { type } = req.params;
  
  const apiMap = {
    'tx': API_CONFIGS.tx,
    'md5': API_CONFIGS.md5
  };
  
  const config = apiMap[type];
  
  if (!config) {
    return res.status(404).json({
      error: true,
      message: 'API type not found',
      availableTypes: Object.keys(apiMap)
    });
  }
  
  handleProxyRequest(req, res, config);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

// Test endpoint
app.get('/test', async (req, res) => {
  const results = {};
  
  for (const [key, config] of Object.entries(API_CONFIGS)) {
    try {
      const testResponse = await axios.get(config.target, {
        params: { api: config.apiParam },
        headers: createProxyHeaders(req),
        timeout: 5000
      });
      
      results[key] = {
        status: testResponse.status,
        success: true
      };
    } catch (error) {
      results[key] = {
        status: error.response?.status || 'ERROR',
        success: false,
        error: error.message
      };
    }
  }
  
  res.json({
    timestamp: new Date().toISOString(),
    results: results
  });
});

// Route chính - chỉ hiển thị endpoints
app.get('/', (req, res) => {
  res.json(['/api/tx', '/api/md5']);
});

// Batch request endpoint
app.post('/api/batch', async (req, res) => {
  try {
    const { requests } = req.body;
    
    if (!Array.isArray(requests)) {
      return res.status(400).json({
        error: true,
        message: 'Requests must be an array'
      });
    }
    
    const results = [];
    
    for (const request of requests) {
      const { endpoint, params = {}, method = 'GET', data = null } = request;
      
      const apiMap = {
        '/api/tx': API_CONFIGS.tx,
        '/api/md5': API_CONFIGS.md5,
        'tx': API_CONFIGS.tx,
        'md5': API_CONFIGS.md5
      };
      
      const config = apiMap[endpoint];
      
      if (!config) {
        results.push({
          endpoint,
          success: false,
          error: 'Invalid endpoint'
        });
        continue;
      }
      
      try {
        const headers = createProxyHeaders(req);
        headers['Content-Type'] = 'application/json';
        
        const allParams = { ...params, api: config.apiParam };
        
        let response;
        if (method.toUpperCase() === 'POST') {
          response = await axios.post(config.target, data, {
            params: allParams,
            headers: headers,
            timeout: 15000
          });
        } else {
          response = await axios.get(config.target, {
            params: allParams,
            headers: headers,
            timeout: 15000
          });
        }
        
        results.push({
          endpoint,
          success: true,
          status: response.status,
          data: response.data
        });
      } catch (error) {
        results.push({
          endpoint,
          success: false,
          error: error.message,
          status: error.response?.status
        });
      }
    }
    
    res.json({
      timestamp: new Date().toISOString(),
      results: results
    });
    
  } catch (error) {
    res.status(500).json({
      error: true,
      message: error.message
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: true,
    message: 'Route not found',
    availableRoutes: ['/api/tx', '/api/md5', '/health', '/test']
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(500).json({
    error: true,
    message: 'Internal server error'
  });
});

// Khởi động server
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`🚀 API Proxy Server running on http://${HOST}:${PORT}`);
  console.log(`\n📡 Available Endpoints:`);
  console.log(`   /api/tx`);
  console.log(`   /api/md5`);

});
