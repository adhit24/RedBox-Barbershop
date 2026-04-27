const mysql = require('mysql2/promise');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function seed() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true // Crucial for running the whole schema file
  });

  try {
    console.log('Reading mysql_schema.sql...');
    const sql = fs.readFileSync(path.join(__dirname, 'mysql_schema.sql'), 'utf8');

    console.log('Executing SQL Schema...');
    await connection.query(sql);
    
    console.log('✅ Database seeded successfully!');
  } catch (error) {
    console.error('❌ Error seeding database:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('Please make sure MySQL is running in XAMPP!');
    }
  } finally {
    await connection.end();
  }
}

seed();
