// const express = require('express');
// const net = require('net');
// const dns = require('dns');
// const multer = require('multer');
// const csvParser = require('csv-parser');
// const fs = require('fs');
// const path = require('path');
// const cors = require('cors');
// const xlsx = require('xlsx');

import express from 'express';
import net from 'net';
import dns from 'dns';
import multer from 'multer';
import csvParser from 'csv-parser';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import xlsx from 'xlsx';
import pLimit from 'p-limit';

// let pLimit;

// // Dynamically load p-limit
// (async () => {
//   pLimit = (await import('p-limit')).default;
// })();

// Enable CORS for all origins
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 8000;

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });


function getMXRecords(domain) {
  return new Promise((resolve, reject) => {
    dns.resolveMx(domain, (err, addresses) => {
      if (err) {
        return reject(err);                          
      }
      if (addresses.length === 0) {
        return reject(new Error('No MX records found.'));
      }
      // Sort addresses by priority
      addresses.sort((a, b) => a.priority - b.priority);
      resolve(addresses[0].exchange); // Return the highest-priority MX server
    });
  });
}

// Function to get MX records for the domain with caching
const mxCache = {};
function getCachedMXRecords(domain) {
  return new Promise((resolve, reject) => {
    if (mxCache[domain]) {
      return resolve(mxCache[domain]);
    }
    dns.resolveMx(domain, (err, addresses) => {
      if (err) {
        return reject(err);
      }
      if (addresses.length === 0) {
        return reject(new Error('No MX records found.'));
      }
      addresses.sort((a, b) => a.priority - b.priority);
      mxCache[domain] = addresses[0].exchange;
      resolve(mxCache[domain]);
    });
  });
}

// Function to validate the email through SMTP commands
function validateEmail(mxHost, email) {
  return new Promise((resolve, reject) => {
    const domain = email.split('@')[1];
    const client = net.createConnection(25, mxHost, () => {
      let step = 0;

      client.on('data', (data) => {
        const response = data.toString();
        switch (step) {
          case 0:
            client.write(`HELO ${domain}\r\n`);
            step++;
            break;
          case 1:
            client.write(`MAIL FROM:<test@${domain}>\r\n`);
            step++;
            break;
          case 2:
            client.write(`RCPT TO:<${email}>\r\n`);
            step++;
            break;
          case 3:
            if (response.includes('250')) {
              resolve({ exists: true, deliverable: true });
            } else if (response.includes('550')) {
              resolve({ exists: false, deliverable: false });
            } else {
              reject(new Error('Unexpected response: ' + response));
            }
            client.write('QUIT\r\n');
            client.end();
            break;
        }
      });
    });

    client.on('error', (err) => {
      reject(err);
    });
  });
}

// Batch processing to limit concurrency
const batchSize = 100; // Adjust based on needs
const limit = pLimit(10); // Limit the number of concurrent connections

const processInBatches = async (emails, results) => {
  for (let i = 0; i < emails.length; i += batchSize) {
    const batch = emails.slice(i, i + batchSize);
    await Promise.all(batch.map((email) => limit(() => validateAndPushEmail(email, results))));
  }
};

app.post('/validate-email', async (req, res) => {
  const { email } = req.body;

  console.log("single email route =",email,req.body)
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  const domain = email.split('@')[1];

  try {
    const mxHost = await getMXRecords(domain);
    const emailValidation = await validateEmail(mxHost, email);

    if (emailValidation.exists) {
      res.json({
        email:email,
        success: true,
        message: `Email exists`,
        deliverable: emailValidation.deliverable
          ? 'Yes' : 'No',
      });
    } else {
      res.json({ success: false, message: 'Email does not exist' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API route for bulk email validation from CSV or Excel files
app.post('/validate-emails', upload.single('file'), async (req, res) => {
  const filePath = req.file.path;
  const results = [];
  const emailsToValidate = [];

  // Check file extension for CSV or Excel
  const fileExtension = path.extname(req.file.originalname).toLowerCase();
  if (!req.file || (fileExtension !== '.csv' && fileExtension !== '.xlsx')) {
    return res.status(400).json({ success: false, message: 'Please upload a valid CSV or Excel file' });
  }

  try {
    if (fileExtension === '.csv') {
      // Process CSV file
      fs.createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (row) => {
          Object.values(row).forEach((value) => {
            if (value && typeof value === 'string' && value.includes('@')) {
              emailsToValidate.push(value.trim());
              console.log("email =",value.trim())
            }
          });
        })
        .on('end', async () => {
          await finalizeResponse(emailsToValidate, results, filePath, res);
        });

    } else if (fileExtension === '.xlsx') {
      // Process Excel file
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

      worksheet.forEach((row) => {
        Object.values(row).forEach((value) => {
          if (value && typeof value === 'string' && value.includes('@')) {
            console.log("email =",value.trim())
            emailsToValidate.push(value.trim());
          }
        });
      });

      console.log("await finalizeResponse")
      await finalizeResponse(emailsToValidate, results, filePath, res);
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper function to validate an email and push results
const validateAndPushEmail = async (email, results) => {
  try {
    const domain = email.split('@')[1];
    const mxHost = await getCachedMXRecords(domain);
    const validationResult = await validateEmail(mxHost, email);
    console.log("email from validate and push =",email)
    results.push({
      email: email,
      exists: validationResult.exists,
      deliverable: validationResult.deliverable ? 'Yes' : 'No',
    });
  } catch (error) {
    results.push({ email, error: error.message });
  }
};

// Helper function to finalize the response
const finalizeResponse = async (emailsToValidate, results, filePath, res) => {
  try {
    await processInBatches(emailsToValidate, results);
    fs.unlink(filePath, (err) => {
      if (err) console.error('Failed to delete file:', err);
    }); // Asynchronous file deletion
    console.log("results =",results)
    res.json({ success: true, message: 'Bulk email validation completed', results });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error completing validation', error: err.message });
  }
};

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
