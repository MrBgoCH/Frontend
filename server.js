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

// PRODUCTS ENDPOINTS
// Get all products
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, c.name as company_name 
      FROM products p 
      LEFT JOIN companies c ON p.company_id = c.id 
      ORDER BY p.id
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Add a product
app.post('/api/products', async (req, res) => {
  const { name, company_id, description } = req.body;
  
  if (!name || !company_id) {
    return res.status(400).json({ error: 'Product name and company ID are required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO products (name, company_id, description, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *',
      [name, company_id, description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error adding product:', err);
    res.status(500).json({ error: 'Failed to add product' });
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

// DATABASE SETUP ENDPOINT (updated for your schema)
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
    
    // Check if products table exists (will be created once you provide structure)
    const productsCheck = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'products'
    `);
    
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
      productsTable: productsCheck.rows.length > 0 ? 'Exists' : 'Waiting for structure',
      activeCompaniesView: 'Created'
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
