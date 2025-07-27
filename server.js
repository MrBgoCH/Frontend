// server.js
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to database:', err);
  } else {
    console.log('Connected to PostgreSQL database');
    release();
  }
});

// COMPANIES ENDPOINTS
// Get all companies
app.get('/api/companies', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM companies ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching companies:', err);
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
});

// Add a company
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

// Bulk add companies
app.post('/api/companies/bulk', async (req, res) => {
  const { companies } = req.body;
  
  if (!companies || !Array.isArray(companies)) {
    return res.status(400).json({ error: 'Companies array is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const addedCompanies = [];
    for (const company of companies) {
      const result = await client.query(
        'INSERT INTO companies (name, url, domain, industry, description, is_active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [company.name, company.url || null, company.domain || null, company.industry || null, company.description || null, true]
      );
      addedCompanies.push(result.rows[0]);
    }
    
    await client.query('COMMIT');
    res.status(201).json({ companies: addedCompanies, count: addedCompanies.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error bulk adding companies:', err);
    res.status(500).json({ error: 'Failed to add companies' });
  } finally {
    client.release();
  }
});

// Update company status (activate/deactivate)
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

// Delete a company
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

// PRODUCTS ENDPOINTS - UPDATED FOR FULL SHOPIFY SCHEMA
// Get all products with company information
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

// Add a product with full Shopify schema
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
  
  // Validate required fields
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
    if (err.code === '23505') { // Unique constraint violation
      res.status(409).json({ error: 'Product with this Shopify ID already exists for this company' });
    } else {
      res.status(500).json({ error: 'Failed to add product' });
    }
  }
});

// Bulk add products
app.post('/api/products/bulk', async (req, res) => {
  const { products } = req.body;
  
  if (!products || !Array.isArray(products)) {
    return res.status(400).json({ error: 'Products array is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const addedProducts = [];
    const skippedProducts = [];
    
    for (const product of products) {
      try {
        const result = await client.query(`
          INSERT INTO products (
            company_id, shopify_product_id, title, handle, product_type, vendor, 
            price, created_at_shopify, days_old_when_found, product_url, 
            main_image_url, tags, first_seen, last_seen, is_new_product
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) 
          RETURNING *
        `, [
          product.company_id,
          product.shopify_product_id || null,
          product.title,
          product.handle || null,
          product.product_type || null,
          product.vendor || null,
          product.price || null,
          product.created_at_shopify || null,
          product.days_old_when_found || null,
          product.product_url || null,
          product.main_image_url || null,
          product.tags || null,
          product.first_seen || new Date(),
          product.last_seen || new Date(),
          product.is_new_product !== undefined ? product.is_new_product : true
        ]);
        addedProducts.push(result.rows[0]);
      } catch (err) {
        if (err.code === '23505') {
          skippedProducts.push({ ...product, reason: 'Duplicate Shopify ID' });
        } else {
          throw err; // Re-throw other errors
        }
      }
    }
    
    await client.query('COMMIT');
    res.status(201).json({ 
      products: addedProducts, 
      added: addedProducts.length,
      skipped: skippedProducts.length,
      skippedProducts
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error bulk adding products:', err);
    res.status(500).json({ error: 'Failed to add products' });
  } finally {
    client.release();
  }
});

// Update a product
app.put('/api/products/:id', async (req, res) => {
  const { id } = req.params;
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
    last_seen,
    is_new_product
  } = req.body;
  
  if (!title) {
    return res.status(400).json({ error: 'Product title is required' });
  }

  try {
    const result = await pool.query(`
      UPDATE products SET 
        company_id = $1,
        shopify_product_id = $2,
        title = $3,
        handle = $4,
        product_type = $5,
        vendor = $6,
        price = $7,
        created_at_shopify = $8,
        days_old_when_found = $9,
        product_url = $10,
        main_image_url = $11,
        tags = $12,
        last_seen = $13,
        is_new_product = $14
      WHERE id = $15 
      RETURNING *
    `, [
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
      last_seen || new Date(),
      is_new_product,
      id
    ]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// Delete a product
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

// Get products by company
app.get('/api/products/company/:companyId', async (req, res) => {
  const { companyId } = req.params;
  
  try {
    const result = await pool.query(`
      SELECT p.*, c.name as company_name 
      FROM products p 
      LEFT JOIN companies c ON p.company_id = c.id 
      WHERE p.company_id = $1 
      ORDER BY p.first_seen DESC
    `, [companyId]);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching products by company:', err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// MONITORING CONFIG ENDPOINTS
// Get all monitoring configs
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

// Save monitoring config (upsert)
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

// Delete monitoring config
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

// STATISTICS ENDPOINT - New for enhanced admin panel
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

// DATABASE SETUP ENDPOINT - Updated with full products table
app.post('/api/setup-database', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Check if companies table exists and has correct structure
    const companiesCheck = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'companies'
    `);
    
    if (companiesCheck.rows.length === 0) {
      // Create companies table if it doesn't exist
      await client.query(`
        CREATE TABLE companies (
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
    }
    
    // Check if monitoring_configs table exists
    const monitoringCheck = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'monitoring_configs'
    `);
    
    if (monitoringCheck.rows.length === 0) {
      // Create monitoring_configs table if it doesn't exist
      await client.query(`
        CREATE TABLE monitoring_configs (
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
    }
    
    // Check if products table exists with full schema
    const productsCheck = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'products'
    `);
    
    if (productsCheck.rows.length === 0) {
      // Create products table with full Shopify schema
      await client.query(`
        CREATE TABLE products (
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
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(company_id, shopify_product_id)
        )
      `);
      
      // Create indexes for better performance
      await client.query('CREATE INDEX idx_products_company_id ON products(company_id)');
      await client.query('CREATE INDEX idx_products_shopify_id ON products(shopify_product_id)');
      await client.query('CREATE INDEX idx_products_is_new ON products(is_new_product)');
      await client.query('CREATE INDEX idx_products_first_seen ON products(first_seen)');
    }
    
    // Create active_companies_for_monitoring view
    await client.query(`
      CREATE OR REPLACE VIEW active_companies_for_monitoring AS
      SELECT c.*, mc.days_back, mc.max_products, mc.check_frequency, 
             mc.is_enabled as monitoring_enabled, mc.last_monitored
      FROM companies c
      LEFT JOIN monitoring_configs mc ON c.id = mc.company_id
      WHERE c.is_active = true AND (mc.is_enabled = true OR mc.is_enabled IS NULL)
    `);
    
    await client.query('COMMIT');
    res.json({ 
      message: 'Database setup completed successfully',
      companiesTable: 'Ready',
      monitoringConfigsTable: 'Ready',
      productsTable: 'Ready with full Shopify schema',
      activeCompaniesView: 'Created',
      indexes: 'Created for better performance'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error setting up database:', err);
    res.status(500).json({ error: 'Failed to setup database' });
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

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
