// const express = require('express');
// const net = require('net');
// const dns = require('dns');

// const app = express();
// app.use(express.json());

// const PORT = 8000;

// // Function to get MX records for the domain
// function getMXRecords(domain) {
//   return new Promise((resolve, reject) => {
//     dns.resolveMx(domain, (err, addresses) => {
//       if (err) {
//         return reject(err);
//       }
//       if (addresses.length === 0) {
//         return reject(new Error('No MX records found.'));
//       }
//       // Sort addresses by priority
//       addresses.sort((a, b) => a.priority - b.priority);
//       resolve(addresses[0].exchange); // Return the highest-priority MX server
//     });
//   });
// }

// // Function to validate the email through SMTP commands
// function validateEmail(mxHost, email) {
//   return new Promise((resolve, reject) => {
//     const domain = email.split('@')[1];
//     const client = net.createConnection(25, mxHost, () => {
//       let step = 0;

//       client.on('data', (data) => {
//         const response = data.toString();

//         switch (step) {
//           case 0:
//             client.write(`HELO ${domain}\r\n`);
//             step++;
//             break;
//           case 1:
//             client.write(`MAIL FROM:<test@${domain}>\r\n`);
//             step++;
//             break;
//           case 2:
//             client.write(`RCPT TO:<${email}>\r\n`);
//             step++;
//             break;
//           case 3:
//             if (response.includes('250')) {
//               resolve({
//                 exists: true,
//                 deliverable: true, // Email exists and is deliverable
//               });
//             } else if (response.includes('550')) {
//               resolve({
//                 exists: false,
//                 deliverable: false, // Email exists but is undeliverable
//               });
//             } else {
//               reject(new Error('Unexpected response: ' + response));
//             }
//             client.write('QUIT\r\n');
//             client.end();
//             break;
//         }
//       });
//     });

//     client.on('error', (err) => {
//       reject(err);
//     });
//   });
// }

// // API route to check if an email exists and is deliverable
// app.post('/validate-email', async (req, res) => {
//   const { email } = req.body;

//   if (!email || !email.includes('@')) {
//     return res.status(400).json({ error: 'Invalid email format' });
//   }

//   const domain = email.split('@')[1];

//   try {
//     const mxHost = await getMXRecords(domain);
//     const emailValidation = await validateEmail(mxHost, email);

//     if (emailValidation.exists) {
//       res.json({
//         success: true,
//         message: `Email exists`,
//         deliverable: emailValidation.deliverable
//           ? 'Yes, email is deliverable'
//           : 'No, email is undeliverable',
//       });
//     } else {
//       res.json({ success: false, message: 'Email does not exist' });
//     }
//   } catch (err) {
//     res.status(500).json({ success: false, error: err.message });
//   }
// });

// // Start the server
// app.listen(PORT, () => {
//   console.log(`Server is running on port ${PORT}`);
// });




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

app.use(cors({
    origin: '*',
}));

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
      // Sort addresses by priority
      addresses.sort((a, b) => a.priority - b.priority);
      resolve(addresses[0].exchange); // Return the highest-priority MX server
    });
  });
}

// Function to validate the email through SMTP commands
function validateEmail(mxHost, email) {
    console.log("email =",email)
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

// API route to check if an email exists and is deliverable
app.post('/validate-email', async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  const domain = email.split('@')[1];

  try {
    const mxHost = await getMXRecords(domain);
    const emailValidation = await validateEmail(mxHost, email);

    if (emailValidation.exists) {
      res.json({
        success: true,
        message: `Email exists`,
        deliverable: emailValidation.deliverable
          ? 'Yes, email is deliverable'
          : 'No, email is undeliverable',
      });
    } else {
      res.json({ success: false, message: 'Email does not exist' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// New API route for bulk email validation from a CSV file
// app.post('/validate-emails-csv', upload.single('file'), async (req, res) => {
//     console.log("validate csv console")
//   const filePath = req.file.path;
//   const results = [];

//   // Check if the uploaded file exists and is in CSV format
//   if (!req.file || path.extname(req.file.originalname) !== '.csv') {
//     return res.status(400).json({ success: false, message: 'Please upload a valid CSV file' });
//   }

//   try {
//     // Parse the CSV file and validate each email
//     console.log("validate csv console try block")
//     fs.createReadStream(filePath)
//       .pipe(csvParser())
//       .on('data', async (row) => {
//           const email = row.email; // Assuming the CSV has a column named "email"
//           console.log("row email =",row.email,row,(email && email.includes('@')))
//         if (email && email.includes('@')) {
//           try {
//             const domain = email.split('@')[1];
//             const mxHost = await getMXRecords(domain);
//             const validationResult = await validateEmail(mxHost, email);
//             console.log("validate csv ",email,validationResult)

//             results.push({
//               email: email,
//               exists: validationResult.exists,
//               deliverable: validationResult.deliverable ? 'Yes' : 'No'
//             });

//           } catch (error) {
//             results.push({ email, error: error.message });
//           }
//         } else {
//           results.push({ email, error: 'Invalid email format' });
//         }
//       })
//       .on('end', () => {
//         console.log("on end block ")
//         // Remove the uploaded file after processing
//         fs.unlinkSync(filePath);

//         // Send the results back to the client
//         res.json({
//           success: true,
//           message: 'Bulk email validation completed',
//           results,
//         });
//       })
//       .on('error', (err) => {
//         res.status(500).json({ success: false, message: 'Error processing the CSV file', error: err.message });
//       });
//   } catch (err) {
//     res.status(500).json({ success: false, error: err.message });
//   }
// });

app.post('/validate-emails-csv', upload.single('file'), async (req, res) => {
    console.log("validate csv console");
    const filePath = req.file.path;
    const results = [];
    const emailValidationPromises = []; // Store promises for each email validation
  
    // Check if the uploaded file exists and is in CSV format
    if (!req.file || path.extname(req.file.originalname) !== '.csv') {
      return res.status(400).json({ success: false, message: 'Please upload a valid CSV file' });
    }
  
    try {
      // Parse the CSV file and validate each email
      console.log("validate csv console try block");
      fs.createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (row) => {
          const email = row.email; // Assuming the CSV has a column named "email"
          console.log("row email =", row.email, row, (email && email.includes('@')));
  
          if (email && email.includes('@')) {
            const validationPromise = (async () => {
              try {
                const domain = email.split('@')[1];
                const mxHost = await getMXRecords(domain);
                const validationResult = await validateEmail(mxHost, email);
                console.log("validate csv ", email, validationResult);
  
                results.push({
                  email: email,
                  exists: validationResult.exists,
                  deliverable: validationResult.deliverable ? 'Yes' : 'No'
                });
              } catch (error) {
                results.push({ email, error: error.message });
              }
            })();
  
            emailValidationPromises.push(validationPromise);
          } else {
            results.push({ email, error: 'Invalid email format' });
          }
        })
        .on('end', async () => {
          console.log("on end block new");
  
          try {
            // Wait for all email validation promises to finish
            await Promise.all(emailValidationPromises);
  
            // Remove the uploaded file after processing
            fs.unlinkSync(filePath);
  
            // Send the results back to the client
            res.json({
              success: true,
              message: 'Bulk email validation completed',
              results,
            });
          } catch (err) {
            res.status(500).json({ success: false, message: 'Error completing validation', error: err.message });
          }
        })
        .on('error', (err) => {
          res.status(500).json({ success: false, message: 'Error processing the CSV file', error: err.message });
        });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });


  app.post('/validate-emails', upload.single('file'), async (req, res) => {
    console.log("validate file console");
    const filePath = req.file.path;
    const results = [];
    const emailValidationPromises = [];

    // Check if the uploaded file is CSV or Excel
    const fileExtension = path.extname(req.file.originalname).toLowerCase();
    if (!req.file || (fileExtension !== '.csv' && fileExtension !== '.xlsx')) {
        return res.status(400).json({ success: false, message: 'Please upload a valid CSV or Excel file' });
    }

    try {
        if (fileExtension === '.csv') {
            // Process CSV file
            console.log("Processing CSV file...");
            fs.createReadStream(filePath)
                .pipe(csvParser())
                .on('data', (row) => {
                    const email = row.email; // Assuming the CSV has a column named "email"
                    if (email && email.includes('@')) {
                        const validationPromise = validateAndPushEmail(email, results);
                        emailValidationPromises.push(validationPromise);
                    } else {
                        results.push({ email, error: 'Invalid email format' });
                    }
                })
                .on('end', async () => {
                    await finalizeResponse(emailValidationPromises, filePath, res, results);
                });
        } else if (fileExtension === '.xlsx') {
            // Process Excel file
            console.log("Processing Excel file...");
            const workbook = xlsx.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

            worksheet.forEach((row) => {
                const email = row.email; // Assuming Excel has a column named "email"
                console.log("email =",row.email)
                if (email && email.includes('@')) {
                    const validationPromise = validateAndPushEmail(email, results);
                    emailValidationPromises.push(validationPromise);
                } else {
                    results.push({ email, error: 'Invalid email format' });
                }
            });

            await finalizeResponse(emailValidationPromises, filePath, res, results);
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Helper function to validate an email and push to results
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
        // Wait for all email validation promises to finish
        await Promise.all(emailValidationPromises);

        // Remove the uploaded file after processing
        fs.unlinkSync(filePath);

        // Send the results back to the client
        res.json({
            success: true,
            message: 'Bulk email validation completed',
            results,
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error completing validation', error: err.message });
    }
};
  

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

