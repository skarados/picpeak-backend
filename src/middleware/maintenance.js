const { db } = require('../database/db');

// Cache maintenance mode status to avoid DB queries on every request
let maintenanceMode = false;
let lastCheck = 0;
const CACHE_DURATION = 60000; // 1 minute

// Retry configuration for database queries
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

async function queryWithRetry(queryFn, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      return await queryFn();
    } catch (error) {
      if (i === retries - 1) {
        throw error;
      }
      
      // Check if it's a connection error that might benefit from retry
      const isConnectionError = 
        error.message?.includes('Connection terminated') ||
        error.message?.includes('ECONNREFUSED') ||
        error.message?.includes('ETIMEDOUT') ||
        error.code === 'ECONNRESET';
      
      if (isConnectionError) {
        console.warn(`Database connection error, retrying in ${RETRY_DELAY}ms... (attempt ${i + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      } else {
        throw error; // Don't retry non-connection errors
      }
    }
  }
}

async function checkMaintenanceMode() {
  const now = Date.now();
  
  // Use cached value if recent
  if (now - lastCheck < CACHE_DURATION) {
    return maintenanceMode;
  }
  
  try {
    const setting = await queryWithRetry(async () => {
      return await db('app_settings')
        .where('setting_key', 'general_maintenance_mode')
        .where('setting_type', 'general')
        .first();
    });
    
    maintenanceMode = setting ? (setting.setting_value === 'true' || setting.setting_value === true) : false;
    lastCheck = now;
    
    return maintenanceMode;
  } catch (error) {
    console.error('Error checking maintenance mode after retries:', error.message);
    // Return cached value or false if no cache
    return maintenanceMode;
  }
}

// Middleware to enforce maintenance mode
async function maintenanceMiddleware(req, res, next) {
  // Skip maintenance check for certain paths
  const skipPaths = [
    '/api/admin/login',
    '/api/admin/auth/login',
    '/api/public/settings',
    '/health'
  ];
  
  // Allow static assets (uploads, favicons, logos)
  const isStaticAsset = req.path.startsWith('/uploads/') || 
                       req.path.startsWith('/favicons/') || 
                       req.path.startsWith('/logos/');
  
  // Allow admin routes if admin is authenticated
  const isAdminRoute = req.path.startsWith('/api/admin');
  const hasAdminAuth = req.headers.authorization?.startsWith('Bearer ');
  
  if (skipPaths.includes(req.path) || isStaticAsset || (isAdminRoute && hasAdminAuth)) {
    return next();
  }
  
  try {
    const inMaintenance = await checkMaintenanceMode();
    
    if (inMaintenance && !isAdminRoute) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'The system is currently undergoing maintenance. Please try again later.',
        maintenance: true
      });
    }
  } catch (error) {
    // If we can't check maintenance mode, allow the request to proceed
    console.error('Failed to check maintenance mode, allowing request:', error.message);
  }
  
  next();
}

// Function to clear cache when settings change
function clearMaintenanceCache() {
  lastCheck = 0;
}

module.exports = { maintenanceMiddleware, clearMaintenanceCache };