const express = require('express');
const net = require('net');
const dns = require('dns');
const multer = require('multer');
const csvParser = require('csv-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const xlsx = require('xlsx');

// Enable CORS for all origins
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = 8000;

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Function to get MX records for the domain
function getMXRecords(domain) {
  return new Promise((resolve, reject) => {
    dns.resolveMx(domain, (err, addresses) => {
      if (err) {
        return reject(err);
      }
      if (addresses.length === 0) {
        return reject(new Error('No MX records found.'));
      }
      addresses.sort((a, b) => a.priority - b.priority); // Sort by priority
      resolve(addresses[0].exchange); // Return the highest-priority MX server
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
              resolve({
                exists: true,
                deliverable: true, // Email exists and is deliverable
              });
            } else if (response.includes('550')) {
              resolve({
                exists: false,
                deliverable: false, // Email exists but is undeliverable
              });
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

// API route for bulk email validation from CSV or Excel files
app.post('/validate-emails', upload.single('file'), async (req, res) => {
  const filePath = req.file.path;
  const results = [];
  const emailValidationPromises = [];
  
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
          // Check for any field that looks like an email address
          Object.values(row).forEach((value) => {
            if (value && typeof value === 'string' && value.includes('@')) {
              const email = value.trim();
              const validationPromise = validateAndPushEmail(email, results);
              emailValidationPromises.push(validationPromise);
            }
          });
        })
        .on('end', async () => {
          await finalizeResponse(emailValidationPromises, filePath, res, results);
        });

    } else if (fileExtension === '.xlsx') {
      // Process Excel file
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

      worksheet.forEach((row) => {
        // Check for any field that looks like an email address
        Object.values(row).forEach((value) => {
          if (value && typeof value === 'string' && value.includes('@')) {
            const email = value.trim();
            // console.log('email =',value.trim())
            const validationPromise = validateAndPushEmail(email, results);
            emailValidationPromises.push(validationPromise);
          }
        });
      });

      console.log("await finalizeResponse")
      await finalizeResponse(emailValidationPromises, filePath, res, results);
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper function to validate an email and push results
const validateAndPushEmail = async (email, results) => {
  try {
    const domain = email.split('@')[1];
    const mxHost = await getMXRecords(domain);
    const validationResult = await validateEmail(mxHost, email);
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
const finalizeResponse = async (emailValidationPromises, filePath, res, results) => {
  try {
    await Promise.all(emailValidationPromises);
    fs.unlinkSync(filePath); // Remove uploaded file
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
