// server.js - Fixed Database Connection
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Enhanced Database connection with better error handling
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // Add connection pool settings
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test database connection with retry logic
async function testDatabaseConnection() {
  let retries = 3;
  while (retries > 0) {
    try {
      const client = await pool.connect();
      console.log('✅ Connected to PostgreSQL database successfully');
      
      // Test a simple query
      const result = await client.query('SELECT NOW()');
      console.log('✅ Database query test successful:', result.rows[0].now);
      
      client.release();
      return true;
    } catch (err) {
      console.error(`❌ Database connection attempt failed (${4 - retries}/3):`, err.message);
      retries--;
      if (retries > 0) {
        console.log('🔄 Retrying database connection in 2 seconds...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
  console.error('❌ Failed to connect to database after 3 attempts');
  return false;
}

// Initialize database connection
testDatabaseConnection();

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    res.json({ 
      status: 'healthy', 
      database: 'connected',
      timestamp: result.rows[0].now 
    });
  } catch (err) {
    res.status(500).json({ 
      status: 'unhealthy', 
      database: 'disconnected',
      error: err.message 
    });
  }
});

// COMPANIES ENDPOINTS
app.get('/api/companies', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM companies ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching companies:', err);
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
});

app.post('/api/companies', async (req, res) => {
  const { name, url, domain, industry, description } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Company name is required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO companies (name, url, domain, industry, description, is_active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, url || null, domain || null, industry || null, description || null, true]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error adding company:', err);
    res.status(500).json({ error: 'Failed to add company' });
  }
});

app.patch('/api/companies/:id/status', async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;
  
  try {
    const result = await pool.query(
      'UPDATE companies SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [is_active, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating company status:', err);
    res.status(500).json({ error: 'Failed to update company status' });
  }
});

app.delete('/api/companies/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query('DELETE FROM companies WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    res.json({ message: 'Company deleted successfully' });
  } catch (err) {
    console.error('Error deleting company:', err);
    res.status(500).json({ error: 'Failed to delete company' });
  }
});

// PRODUCTS ENDPOINTS
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.*,
        c.name as company_name 
      FROM products p 
      LEFT JOIN companies c ON p.company_id = c.id 
      ORDER BY p.first_seen DESC, p.id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.post('/api/products', async (req, res) => {
  const { 
    company_id,
    shopify_product_id,
    title,
    handle,
    product_type,
    vendor,
    price,
    created_at_shopify,
    days_old_when_found,
    product_url,
    main_image_url,
    tags,
    first_seen,
    last_seen,
    is_new_product
  } = req.body;
  
  if (!company_id || !title) {
    return res.status(400).json({ error: 'Company ID and product title are required' });
  }

  try {
    const result = await pool.query(`
      INSERT INTO products (
        company_id, shopify_product_id, title, handle, product_type, vendor, 
        price, created_at_shopify, days_old_when_found, product_url, 
        main_image_url, tags, first_seen, last_seen, is_new_product
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) 
      RETURNING *
    `, [
      company_id,
      shopify_product_id || null,
      title,
      handle || null,
      product_type || null,
      vendor || null,
      price || null,
      created_at_shopify || null,
      days_old_when_found || null,
      product_url || null,
      main_image_url || null,
      tags || null,
      first_seen || new Date(),
      last_seen || new Date(),
      is_new_product !== undefined ? is_new_product : true
    ]);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error adding product:', err);
    if (err.code === '23505') {
      res.status(409).json({ error: 'Product with this Shopify ID already exists for this company' });
    } else {
      res.status(500).json({ error: 'Failed to add product' });
    }
  }
});

app.delete('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.json({ message: 'Product deleted successfully' });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// MONITORING CONFIG ENDPOINTS
app.get('/api/monitoring-configs', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT mc.*, c.name as company_name 
      FROM monitoring_configs mc 
      LEFT JOIN companies c ON mc.company_id = c.id 
      ORDER BY mc.company_id
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching monitoring configs:', err);
    res.status(500).json({ error: 'Failed to fetch monitoring configs' });
  }
});

app.post('/api/monitoring-configs', async (req, res) => {
  const { 
    company_id, 
    days_back, 
    max_products, 
    check_frequency, 
    is_enabled 
  } = req.body;
  
  if (!company_id) {
    return res.status(400).json({ error: 'Company ID is required' });
  }

  try {
    const result = await pool.query(`
      INSERT INTO monitoring_configs 
      (company_id, days_back, max_products, check_frequency, is_enabled) 
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (company_id) 
      DO UPDATE SET 
        days_back = $2,
        max_products = $3,
        check_frequency = $4,
        is_enabled = $5,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      company_id, 
      days_back || 7, 
      max_products || 50, 
      check_frequency || 'weekly', 
      is_enabled !== undefined ? is_enabled : true
    ]);
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error saving monitoring config:', err);
    res.status(500).json({ error: 'Failed to save monitoring config' });
  }
});

app.delete('/api/monitoring-configs/:company_id', async (req, res) => {
  const { company_id } = req.params;
  
  try {
    const result = await pool.query('DELETE FROM monitoring_configs WHERE company_id = $1 RETURNING *', [company_id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Monitoring config not found' });
    }
    
    res.json({ message: 'Monitoring config deleted successfully' });
  } catch (err) {
    console.error('Error deleting monitoring config:', err);
    res.status(500).json({ error: 'Failed to delete monitoring config' });
  }
});

// STATISTICS ENDPOINT
app.get('/api/stats', async (req, res) => {
  try {
    const [companiesResult, productsResult, newProductsResult, configsResult] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM companies'),
      pool.query('SELECT COUNT(*) as count FROM products'),
      pool.query('SELECT COUNT(*) as count FROM products WHERE is_new_product = true'),
      pool.query('SELECT COUNT(*) as count FROM monitoring_configs WHERE is_enabled = true')
    ]);

    res.json({
      totalCompanies: parseInt(companiesResult.rows[0].count),
      totalProducts: parseInt(productsResult.rows[0].count),
      newProducts: parseInt(newProductsResult.rows[0].count),
      activeConfigs: parseInt(configsResult.rows[0].count)
    });
  } catch (err) {
    console.error('Error fetching statistics:', err);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// DATABASE SETUP ENDPOINT
app.post('/api/setup-database', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Create companies table
    await client.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        url VARCHAR(255),
        domain VARCHAR(100),
        industry VARCHAR(100),
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create monitoring_configs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS monitoring_configs (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        days_back INTEGER DEFAULT 7,
        max_products INTEGER DEFAULT 50,
        check_frequency VARCHAR(20) DEFAULT 'weekly',
        is_enabled BOOLEAN DEFAULT true,
        last_monitored TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(company_id)
      )
    `);
    
    // Create products table with full schema
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        shopify_product_id BIGINT,
        title VARCHAR(500) NOT NULL,
        handle VARCHAR(255),
        product_type VARCHAR(100),
        vendor VARCHAR(100),
        price NUMERIC(10,2),
        created_at_shopify TIMESTAMP,
        days_old_when_found INTEGER,
        product_url TEXT,
        main_image_url TEXT,
        tags TEXT,
        first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_new_product BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Add unique constraint if it doesn't exist
    await client.query(`
      ALTER TABLE products 
      ADD CONSTRAINT unique_company_shopify_product 
      UNIQUE (company_id, shopify_product_id)
      ON CONFLICT DO NOTHING
    `);
    
    // Create indexes
    await client.query('CREATE INDEX IF NOT EXISTS idx_products_company_id ON products(company_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_products_shopify_id ON products(shopify_product_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_products_is_new ON products(is_new_product)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_products_first_seen ON products(first_seen)');
    
    await client.query('COMMIT');
    res.json({ 
      message: 'Database setup completed successfully',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error setting up database:', err);
    res.status(500).json({ error: 'Failed to setup database', details: err.message });
  } finally {
    client.release();
  }
});

// Serve the frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Shutting down gracefully...');
  pool.end(() => {
    console.log('💾 Database pool closed');
    process.exit(0);
  });
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
