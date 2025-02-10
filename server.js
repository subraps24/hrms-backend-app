// Server.js

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2');
const multer = require("multer");
const xlsx = require("xlsx");
const fs = require("fs");
const excel = require('exceljs');
const path = require('path');
const router = express.Router();
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');


const { WebSocketServer } = require('ws');
let isConsolidated = false; // Global flag to track consolidation state

require('dotenv').config();

// Setup
const app = express();
const PORT = 5000;

// Middleware for handling large payloads
app.use(bodyParser.json({ limit: "100mb" }));
app.use(bodyParser.urlencoded({ limit: "100mb", extended: true }));
app.use(cors());




// Database Connection
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'attendance_system'
});

db.connect((err) => {
    if (err) throw err;
    console.log('MySQL Connected...');
});

// API Routes

// API to fetch user details by email
app.get('/api/user-details', (req, res) => {
    const userEmail = req.query.email;

    if (!userEmail) {
        return res.status(400).json({ message: 'Email is required' });
    }

    const sql = `SELECT name, email, role, status, created_at FROM users WHERE email = ?`;

    db.query(sql, [userEmail], (err, result) => {
        if (err) {
            console.error('Error fetching user details:', err);
            return res.status(500).json({ message: 'Failed to fetch user details' });
        }

        if (result.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json(result[0]);
    });
});


const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const uploadDir = path.join(__dirname, 'uploads');
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir);
            }
            cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
            cb(null, `${Date.now()}-${file.originalname}`);
        },
    }),
    fileFilter: (req, file, cb) => {
        console.log('Original filename:', file.originalname); // Debugging
        console.log('File mimetype:', file.mimetype); // Debugging

        const allowedExtensions = ['.xlsx', '.xls', '.csv'];
        const allowedMimeTypes = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
            'application/vnd.ms-excel', // .xls
            'text/csv', // .csv
            'application/csv', // .csv (alternative)
        ];

        const ext = path.extname(file.originalname).toLowerCase();
        const mimetype = file.mimetype;

        if (!allowedExtensions.includes(ext) || !allowedMimeTypes.includes(mimetype)) {
            return cb(new Error('Only .xlsx, .xls, and .csv files are allowed'));
        }
        cb(null, true);
    },

});
// Fetch all available locations
app.get('/api/locations', (req, res) => {
    const sql = 'SELECT * FROM locations';
    db.query(sql, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Failed to fetch locations' });
        }
        res.status(200).json(results);
    });
});

// Post new locations
app.post('/api/locations', (req, res) => {
    const { name, address_line1, address_line2, city, state, country, pincode, contact_number } = req.body;
    const sql = `
        INSERT INTO locations (name, address_line1, address_line2, country, state, city, pincode, contact_number)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    db.query(
        sql,
        [name, address_line1, address_line2, country, state, city, pincode, contact_number],
        (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ message: 'Failed to add location' });
            }
            res.status(201).json({ message: 'Location added successfully' });
        }
    );
});


// Dropdown Implementation and excel file header data
app.get('/api/locations/template', (req, res) => {
    const workbook = new excel.Workbook();
    const sheet = workbook.addWorksheet('Locations');

    // Define columns with headers
    sheet.columns = [
        { header: 'Name', key: 'name', width: 20 },
        { header: 'Address Line 1', key: 'address_line1', width: 25 },
        { header: 'Address Line 2', key: 'address_line2', width: 25 },
        { header: 'Country', key: 'country', width: 15 },
        { header: 'State', key: 'state', width: 15 },
        { header: 'City', key: 'city', width: 15 },
        { header: 'Pincode', key: 'pincode', width: 10 },
        { header: 'Contact Number', key: 'contact_number', width: 15 },
    ];

    // Add sample data
    sheet.addRow({
        name: 'Sample Name',
        address_line1: '123 Sample Street',
        address_line2: 'Apt 456',
        country: 'India',
        state: 'Tamil Nadu',
        city: 'Chennai',
        pincode: '600001',
        contact_number: '9876543210',
    });

    // Add a hidden sheet for dropdown data
    const hiddenSheet = workbook.addWorksheet('DropdownData');
    hiddenSheet.state = 'hidden';

    // Populate the hidden sheet with dropdown data
    const states = [
        'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
        'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
        'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
        'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
        'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
    ];

    const cities = {
        'Andhra Pradesh': ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Kakinada', 'Nellore'],
        'Tamil Nadu': ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem'],
        // Add other states and their cities as required
    };

    // Add Country dropdown data
    hiddenSheet.getColumn(1).values = ['Country', 'India'];

    // Add State dropdown data
    hiddenSheet.getColumn(2).values = ['States', ...states];

    // Add City dropdown data (each state gets its own column)
    let columnIndex = 3;
    Object.entries(cities).forEach(([state, citiesList]) => {
        hiddenSheet.getColumn(columnIndex).values = [state, ...citiesList];
        columnIndex++;
    });

    // Apply dropdowns for Country
    sheet.getColumn('country').eachCell((cell, rowNumber) => {
        if (rowNumber > 1) {
            cell.value = 'India';
            cell.dataValidation = {
                type: 'list',
                allowBlank: false,
                formula1: `'DropdownData'!$A$2`, // Refers to the Country column in the hidden sheet
            };
        }
    });

    // Apply dropdowns for State
    sheet.getColumn('state').eachCell((cell, rowNumber) => {
        if (rowNumber > 1) {
            cell.dataValidation = {
                type: 'list',
                allowBlank: true,
                formula1: `'DropdownData'!$B$2:$B${states.length + 1}`, // Refers to the State column in the hidden sheet
            };
        }
    });

    // Apply dropdowns for City
    sheet.getColumn('city').eachCell((cell, rowNumber) => {
        if (rowNumber > 1) {
            // Example for Tamil Nadu cities
            cell.dataValidation = {
                type: 'list',
                allowBlank: true,
                formula1: `'DropdownData'!$C$2:$C${cities['Tamil Nadu'].length + 1}`, // Refers to Tamil Nadu cities in the hidden sheet
            };
        }
    });

    // Send the Excel file as a response
    res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
        'Content-Disposition',
        'attachment; filename=Location_Template.xlsx'
    );
    workbook.xlsx.write(res).then(() => res.end());
});




// Upload and Parse Excel File
app.post('/api/locations/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
    }

    const filePath = req.file.path;

    const workbook = new excel.Workbook();
    workbook.xlsx
        .readFile(filePath)
        .then(() => {
            const sheet = workbook.getWorksheet(1);
            const locations = [];

            sheet.eachRow((row, rowIndex) => {
                if (rowIndex === 1) return; // Skip header row
                const location = {
                    name: row.getCell(1).value,
                    address_line1: row.getCell(2).value,
                    address_line2: row.getCell(3).value,
                    country: row.getCell(4).value,
                    state: row.getCell(5).value,
                    city: row.getCell(6).value,
                    pincode: row.getCell(7).value,
                    contact_number: row.getCell(8).value,
                };
                locations.push(location);
            });

            const insertQuery = `
                INSERT INTO locations (name, address_line1, address_line2, country, state, city, pincode, contact_number)
                VALUES ?
            `;
            const values = locations.map((loc) => [
                loc.name,
                loc.address_line1,
                loc.address_line2,
                loc.country,
                loc.state,
                loc.city,
                loc.pincode,
                loc.contact_number,
            ]);

            db.query(insertQuery, [values], (err) => {
                if (err) {
                    console.error('Error inserting locations:', err);
                    return res.status(500).json({ message: 'Failed to upload locations' });
                }
                res.status(200).json({ message: 'Locations uploaded successfully' });
            });
        })
        .catch((err) => {
            console.error('Error parsing Excel file:', err);
            res.status(500).json({ message: 'Error parsing Excel file' });
        })
        .finally(() => {
            fs.unlinkSync(filePath); // Delete the file after processing
        });
});



// Register Request (Add with Pending Status)
app.post('/api/register', async (req, res) => {
    const { name, email, password, role, location_id } = req.body;

    // Check if the email is already registered
    const sqlCheck = `
        SELECT id, status, location_id 
        FROM users 
        WHERE email = ?`;

    db.query(sqlCheck, [email], async (err, results) => {
        if (err) return res.status(500).json({ message: 'Server error' });

        if (results.length > 0) {
            const existingUser = results[0];

            // If the user is Rejected, allow re-registration
            if (existingUser.status === 'Rejected') {
                // Allow re-registration with the same email and location
                const hashedPassword = await bcrypt.hash(password, 10);
                const sqlInsert = `
                    INSERT INTO users (name, email, password, role, location_id, status) 
                    VALUES (?, ?, ?, ?, ?, ?)`;
                db.query(sqlInsert, [name, email, hashedPassword, role, location_id, 'Pending'], (err, result) => {
                    if (err) {
                        console.error(err);
                        return res.status(500).json({ message: 'Registration failed' });
                    }

                    // Fetch location details
                    const sqlFetchLocation = `
                        SELECT l.name AS location_name, l.latitude, l.longitude
                        FROM locations l
                        WHERE l.id = ?`;
                    db.query(sqlFetchLocation, [location_id], (err, locationResults) => {
                        if (err) {
                            console.error(err);
                            return res.status(500).json({ message: 'Failed to fetch location details' });
                        }

                        const location = locationResults[0];
                        const newUser = {
                            id: result.insertId,
                            name,
                            email,
                            role,
                            location_id,
                            location_name: location?.location_name || 'Unknown',
                            latitude: location?.latitude,
                            longitude: location?.longitude,
                            status: 'Pending',
                            created_at: new Date(),
                        };

                        // Notify WebSocket clients about the new registration
                        broadcastToClients(JSON.stringify({ type: 'NEW_REGISTRATION', payload: newUser }));

                        res.status(201).json({ message: 'Registration request submitted successfully' });
                    });
                });
                return;
            }

            // If the user is Pending or Active, check the location
            if (existingUser.status === 'Pending' || existingUser.status === 'Active') {
                if (existingUser.location_id === location_id) {
                    return res.status(409).json({ message: 'User is already registered at this location with Pending or Active status.' });
                } else {
                    // Allow re-registration with a different location
                    const hashedPassword = await bcrypt.hash(password, 10);
                    const sqlInsert = `
                        INSERT INTO users (name, email, password, role, location_id, status) 
                        VALUES (?, ?, ?, ?, ?, ?)`;
                    db.query(sqlInsert, [name, email, hashedPassword, role, location_id, 'Pending'], (err, result) => {
                        if (err) {
                            console.error(err);
                            return res.status(500).json({ message: 'Registration failed' });
                        }

                        // Fetch location details
                        const sqlFetchLocation = `
                            SELECT l.name AS location_name, l.latitude, l.longitude
                            FROM locations l
                            WHERE l.id = ?`;
                        db.query(sqlFetchLocation, [location_id], (err, locationResults) => {
                            if (err) {
                                console.error(err);
                                return res.status(500).json({ message: 'Failed to fetch location details' });
                            }

                            const location = locationResults[0];
                            const newUser = {
                                id: result.insertId,
                                name,
                                email,
                                role,
                                location_id,
                                location_name: location?.location_name || 'Unknown',
                                latitude: location?.latitude,
                                longitude: location?.longitude,
                                status: 'Pending',
                                created_at: new Date(),
                            };

                            // Notify WebSocket clients about the new registration
                            broadcastToClients(JSON.stringify({ type: 'NEW_REGISTRATION', payload: newUser }));

                            res.status(201).json({ message: 'Registration request submitted successfully' });
                        });
                    });
                    return;
                }
            }

            // Otherwise, do not allow re-registration
            return res.status(409).json({ message: 'User is already registered with Pending or Active status.' });
        }

        // If no existing user, proceed with new registration
        const hashedPassword = await bcrypt.hash(password, 10);
        const sqlInsert = `
            INSERT INTO users (name, email, password, role, location_id, status) 
            VALUES (?, ?, ?, ?, ?, ?)`;
        db.query(sqlInsert, [name, email, hashedPassword, role, location_id, 'Pending'], (err, result) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ message: 'Registration failed' });
            }

            // Fetch location details
            const sqlFetchLocation = `
                SELECT l.name AS location_name, l.latitude, l.longitude
                FROM locations l
                WHERE l.id = ?`;
            db.query(sqlFetchLocation, [location_id], (err, locationResults) => {
                if (err) {
                    console.error(err);
                    return res.status(500).json({ message: 'Failed to fetch location details' });
                }

                const location = locationResults[0];
                const newUser = {
                    id: result.insertId,
                    name,
                    email,
                    role,
                    location_id,
                    location_name: location?.location_name || 'Unknown',
                    google_maps_url: location?.google_maps_url || null,
                    latitude: location?.latitude,
                    longitude: location?.longitude,
                    status: 'Pending',
                    created_at: new Date(),
                };

                // Notify WebSocket clients about the new registration
                broadcastToClients(JSON.stringify({ type: 'NEW_REGISTRATION', payload: newUser }));

                res.status(201).json({ message: 'Registration request submitted successfully' });
            });
        });
    });
});

// Fetch pending users with location details
app.get('/api/pending-users', (req, res) => {
    const sql = `
        SELECT 
    u.id, u.name, u.email, u.role, u.created_at, 
    l.name AS location_name, l.latitude, l.longitude, l.google_maps_url
FROM users u 
LEFT JOIN locations l ON u.location_id = l.id 
WHERE u.status = 'Pending'
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ message: 'Failed to fetch pending users' });
        res.status(200).json(results);
    });
});

// Approve User and Assign Role
app.post('/api/approve-user', (req, res) => {
    const { id, role } = req.body;

    const locationId = role === 'CEO' || role === 'CFO' ? null : req.body.location_id; // Assign all locations for CEO/CFO
    const sql = 'UPDATE users SET status = ?, role = ?, location_id = ? WHERE id = ?';
    db.query(sql, ['Active', role, locationId, id], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Failed to approve user' });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Notify WebSocket clients about the approved user
        broadcastToClients(JSON.stringify({ type: 'USER_APPROVED', payload: { id } }));

        res.status(200).json({ message: 'User approved successfully' });
    });
});

// Reject User and Mention Reason
app.post('/api/reject-user', (req, res) => {
    const { id, reason } = req.body;

    const sql = 'UPDATE users SET status = ?, reason = ? WHERE id = ?';
    db.query(sql, ['Rejected', reason, id], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Failed to reject user' });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Notify WebSocket clients about the rejected user
        broadcastToClients(JSON.stringify({ type: 'USER_REJECTED', payload: { id } }));

        res.status(200).json({ message: 'User rejected successfully' });
    });
});

// Login
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const sql = 'SELECT * FROM users WHERE email = ?';
    db.query(sql, [email], async (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ message: 'Server error' });
        }

        if (results.length === 0) {
            return res.status(401).json({ message: 'User not found' });
        }

        const user = results[0];

        // Check if the user is active
        if (user.status !== 'Active') {
            return res.status(403).json({ message: 'Account is not approved yet' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        console.log('Login successful for user:', email);
        // Return user's name and role
        res.json({ name: user.name, role: user.role });
    });
});

// Secure Route Example
app.get('/api/secure', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ message: 'Unauthorized' });
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        res.json({ message: 'Access granted', user: decoded });
    } catch (err) {
        res.status(401).json({ message: 'Invalid token' });
    }
});

// Fetch all contractors
app.get('/api/contractors', (req, res) => {
    const sql = `
        SELECT 
            c.contractor_id, c.contractor_name, c.contact_number, 
            c.contractor_email, l.name AS location_name, c.creation_date, c.created_by
        FROM contractors c
        LEFT JOIN locations l ON c.location_id = l.id
    `;
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching contractors:', err);
            return res.status(500).json({ message: 'Failed to fetch contractors' });
        }
        res.status(200).json(results);
    });
});

// Add a new contractor
app.post('/api/contractors', (req, res) => {
    const { contractor_name, contact_number, contractor_email, location_id, created_by } = req.body;
    const sql = `
        INSERT INTO contractors (contractor_name, contact_number, contractor_email, location_id, created_by)
        VALUES (?, ?, ?, ?, ?)
    `;
    db.query(sql, [contractor_name, contact_number, contractor_email, location_id, created_by], (err, result) => {
        if (err) {
            console.error('Error adding contractor:', err);
            return res.status(500).json({ message: 'Failed to add contractor' });
        }
        res.status(201).json({ message: 'Contractor added successfully' });
    });
});

// Search contractors by filters
app.get('/api/contractors/search', (req, res) => {
    const { query } = req.query; // Get search query from request
    const sql = `
        SELECT 
            c.contractor_id, c.contractor_name, c.contact_number, 
            c.contractor_email, l.name AS location_name, c.creation_date, c.created_by
        FROM contractors c
        LEFT JOIN locations l ON c.location_id = l.id
        WHERE 
            c.contractor_name LIKE ? OR
            c.contractor_email LIKE ? OR
            l.name LIKE ?
    `;
    const searchQuery = `%${query}%`;
    db.query(sql, [searchQuery, searchQuery, searchQuery], (err, results) => {
        if (err) {
            console.error('Error searching contractors:', err);
            return res.status(500).json({ message: 'Failed to search contractors' });
        }
        res.status(200).json(results);
    });
});

// Delete contractor
app.delete('/api/contractors/:id', (req, res) => {
    const { id } = req.params;
    const sql = 'DELETE FROM contractors WHERE contractor_id = ?';
    db.query(sql, [id], (err, result) => {
        if (err) {
            console.error('Error deleting contractor:', err);
            return res.status(500).json({ message: 'Failed to delete contractor' });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Contractor not found' });
        }
        res.status(200).json({ message: 'Contractor deleted successfully' });
    });
});

///****EMPLOYEE_MASTER******//

// Fetch all employees
app.get('/api/employees', (req, res) => {
    const sql = `
        SELECT 
            e.id,
            e.employee_id,
            e.employee_name,
            e.location_id,
            e.mobile_number,
            e.aadhaar_number,
            e.dob,
            e.address,
            e.father_name,
            e.mother_name,
            e.marital_status,
            e.sex,
            e.blood_group,
            e.esi_number,
            e.pf_number,
            e.education,
            e.created_by,
            e.created_at,
            l.name AS location_name
        FROM employees e
        LEFT JOIN locations l ON e.location_id = l.id;
    `;
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching employees:', err);
            return res.status(500).json({ message: 'Error fetching employees' });
        }
        res.status(200).json(results);
    });
});

// Add a new employee
app.post('/api/employees', (req, res) => {
    const {
        employee_name,
        location_id,
        mobile_number,
        aadhaar_number,
        dob,
        address,
        father_name,
        mother_name,
        marital_status,
        sex,
        blood_group,
        esi_number,
        pf_number,
        education,
        created_by,
    } = req.body;

    // Validate required fields
    if (!employee_name || !location_id) {
        return res.status(400).json({ message: 'Employee Name and Location ID are required.' });
    }

    // Step 1: Fetch the location name
    const locationQuery = `SELECT name FROM locations WHERE id = ?;`;
    db.query(locationQuery, [location_id], (locationErr, locationResults) => {
        if (locationErr || locationResults.length === 0) {
            console.error('Error fetching location name:', locationErr);
            return res.status(500).json({ message: 'Invalid Location ID or database error.' });
        }

        const locationName = locationResults[0].name;
        const locationCode = locationName.split(' ').join('-').toUpperCase().substring(0, 1); // Use 'U' for Unit-1, 'G' for Gummidipoondi, etc.

        // Step 2: Generate a unique employee ID
        const employeeIdQuery = `
            SELECT employee_id FROM employees 
            WHERE employee_id LIKE '${locationCode}%' 
            ORDER BY employee_id DESC LIMIT 1;
        `;
        db.query(employeeIdQuery, (idErr, idResults) => {
            if (idErr) {
                console.error('Error generating employee ID:', idErr);
                return res.status(500).json({ message: 'Error generating employee ID.' });
            }

            let newEmployeeId;
            if (idResults.length > 0) {
                const lastId = idResults[0].employee_id;
                const lastNumber = parseInt(lastId.replace(locationCode, ''), 10);
                newEmployeeId = `${locationCode}${lastNumber + 1}`;
            } else {
                newEmployeeId = `${locationCode}10001`; // Start from U10001
            }

            // Step 3: Insert the new employee into the database
            const insertQuery = `
                INSERT INTO employees (
                    employee_id,
                    employee_name,
                    location_id,
                    mobile_number,
                    aadhaar_number,
                    dob,
                    address,
                    father_name,
                    mother_name,
                    marital_status,
                    sex,
                    blood_group,
                    esi_number,
                    pf_number,
                    education,
                    created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            `;
            db.query(
                insertQuery,
                [
                    newEmployeeId,
                    employee_name,
                    location_id,
                    mobile_number || null,
                    aadhaar_number || null,
                    dob || null,
                    address || null,
                    father_name || null,
                    mother_name || null,
                    marital_status || null,
                    sex || null,
                    blood_group || null,
                    esi_number || null,
                    pf_number || null,
                    education || null,
                    created_by || 'System',
                ],
                (insertErr, insertResult) => {
                    if (insertErr) {
                        console.error('Error adding employee:', insertErr);
                        return res.status(500).json({ message: 'Error adding employee', error: insertErr.message });
                    }
                    res.status(201).json({ message: 'Employee added successfully', employeeId: newEmployeeId });
                }
            );
        });
    });
});


// Update an employee
app.put('/api/employees/:id', (req, res) => {
    const { id } = req.params;
    const {
        employee_id,
        employee_name,
        location_id,
        mobile_number,
        aadhaar_number,
        dob,
        address,
        father_name,
        mother_name,
        marital_status,
        sex,
        blood_group,
        esi_number,
        pf_number,
        education,
    } = req.body;

    if (!employee_id || !employee_name || !location_id) {
        return res.status(400).json({ message: 'Required fields are missing' });
    }

    const sql = `
        UPDATE employees
        SET 
            employee_id = ?,
            employee_name = ?,
            location_id = ?,
            mobile_number = ?,
            aadhaar_number = ?,
            dob = ?,
            address = ?,
            father_name = ?,
            mother_name = ?,
            marital_status = ?,
            sex = ?,
            blood_group = ?,
            esi_number = ?,
            pf_number = ?,
            education = ?
        WHERE id = ?;
    `;
    db.query(
        sql,
        [
            employee_id,
            employee_name,
            location_id,
            mobile_number,
            aadhaar_number,
            dob,
            address,
            father_name,
            mother_name,
            marital_status,
            sex,
            blood_group,
            esi_number,
            pf_number,
            education,
            id,
        ],
        (err, result) => {
            if (err) {
                console.error('Error updating employee:', err);
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Employee not found' });
            }
            res.status(200).json({ message: 'Employee updated successfully' });
        }
    );
});


// Endpoint to download Excel template
app.get('/api/employees/template/:location_id', (req, res) => {
    const { location_id } = req.params;

    // Fetch location details for the header
    const locationQuery = 'SELECT name FROM locations WHERE id = ?';
    db.query(locationQuery, [location_id], (err, results) => {
        if (err || results.length === 0) {
            console.error('Error fetching location:', err);
            return res.status(404).json({ message: 'Location not found' });
        }

        const locationName = results[0].name;

        // Create Excel workbook and worksheet
        const workbook = new excel.Workbook();
        const sheet = workbook.addWorksheet('Employee Template');

        // Define columns
        sheet.columns = [
            { header: 'Employee Name', key: 'employee_name', width: 20 },
            { header: 'Mobile Number', key: 'mobile_number', width: 15 },
            { header: 'Aadhaar Number', key: 'aadhaar_number', width: 15 },
            { header: 'Date of Birth', key: 'dob', width: 15 },
            { header: 'Address', key: 'address', width: 25 },
            { header: 'Father Name', key: 'father_name', width: 20 },
            { header: 'Mother Name', key: 'mother_name', width: 20 },
            { header: 'Marital Status', key: 'marital_status', width: 15 },
            { header: 'Sex', key: 'sex', width: 10 },
            { header: 'Blood Group', key: 'blood_group', width: 10 },
            { header: 'ESI Number', key: 'esi_number', width: 15 },
            { header: 'PF Number', key: 'pf_number', width: 15 },
            { header: 'Education', key: 'education', width: 20 },
        ];



        // Set headers and send the file
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename=Employee_Template_${locationName}.xlsx`
        );

        workbook.xlsx.write(res).then(() => res.end());
    });
});

// Endpoint to upload Excel file
app.post('/api/employees/upload', upload.single('file'), (req, res) => {
    const { location_id, created_by = 'System' } = req.body;
    const filePath = req.file.path;

    if (!location_id) {
        return res.status(400).json({ message: 'Location ID is required.' });
    }

    // Step 1: Fetch the location name and the last employee ID for the location
    const locationQuery = `
        SELECT l.name, 
               (SELECT employee_id 
                FROM employees 
                WHERE location_id = ? 
                ORDER BY employee_id DESC 
                LIMIT 1) AS last_employee_id
        FROM locations l 
        WHERE l.id = ?;
    `;

    db.query(locationQuery, [location_id, location_id], async (locErr, locResults) => {
        if (locErr || locResults.length === 0) {
            console.error('Error fetching location:', locErr);
            fs.unlinkSync(filePath);
            return res.status(404).json({ message: 'Invalid Location ID or database error.' });
        }

        const { name: locationName, last_employee_id } = locResults[0];
        const locationCode = locationName.split(' ').join('-').toUpperCase().substring(0, 1);
        let lastNumber = last_employee_id
            ? parseInt(last_employee_id.replace(locationCode, ''), 10)
            : 10000;

        // Read the uploaded Excel file
        const workbook = new excel.Workbook();
        try {
            await workbook.xlsx.readFile(filePath);
            const sheet = workbook.getWorksheet(1); // Get the first worksheet
            const employees = [];

            // Parse rows from Excel file
            sheet.eachRow((row, rowIndex) => {
                if (rowIndex > 1) { // Skip header row
                    lastNumber++; // Increment the last number for each employee
                    employees.push({
                        employee_id: `${locationCode}${lastNumber}`,
                        employee_name: row.getCell(1).value,
                        mobile_number: row.getCell(2).value,
                        aadhaar_number: row.getCell(3).value,
                        dob: row.getCell(4).value,
                        address: row.getCell(5).value,
                        father_name: row.getCell(6).value,
                        mother_name: row.getCell(7).value,
                        marital_status: row.getCell(8).value,
                        sex: row.getCell(9).value,
                        blood_group: row.getCell(10).value,
                        esi_number: row.getCell(11).value,
                        pf_number: row.getCell(12).value,
                        education: row.getCell(13).value,
                    });
                }
            });

            // Step 2: Insert employees into the database
            const insertQuery = `
                INSERT INTO employees (
                    employee_id, employee_name, location_id, mobile_number, aadhaar_number,
                    dob, address, father_name, mother_name, marital_status, sex,
                    blood_group, esi_number, pf_number, education, created_by
                ) VALUES ?
            `;

            const values = employees.map((emp) => [
                emp.employee_id,
                emp.employee_name,
                location_id,
                emp.mobile_number || null,
                emp.aadhaar_number || null,
                emp.dob || null,
                emp.address || null,
                emp.father_name || null,
                emp.mother_name || null,
                emp.marital_status || null,
                emp.sex || null,
                emp.blood_group || null,
                emp.esi_number || null,
                emp.pf_number || null,
                emp.education || null,
                created_by,
            ]);

            db.query(insertQuery, [values], (err, result) => {
                fs.unlinkSync(filePath); // Delete the uploaded file

                if (err) {
                    console.error('Error inserting employees:', err);
                    return res.status(500).json({ message: 'Error inserting employees', error: err.message });
                }

                res.status(201).json({ message: 'Employees uploaded successfully', rowsInserted: result.affectedRows });
            });
        } catch (error) {
            console.error('Error reading Excel file:', error);
            fs.unlinkSync(filePath);
            res.status(500).json({ message: 'Error reading Excel file', error: error.message });
        }
    });
});



module.exports = app;


// Delete an employee
app.delete('/api/employees/:id', (req, res) => {
    const { id } = req.params;

    const sql = `
        DELETE FROM employees WHERE id = ?;
    `;
    db.query(sql, [id], (err, result) => {
        if (err) {
            console.error('Error adding employee:', err);
            return res.status(500).json({ message: 'Error adding employee', error: err.message });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Employee not found' });
        }
        res.status(200).json({ message: 'Employee deleted successfully' });
    });
});

///****SHIFT MASTER */

// Fetch all Shift Masters
app.get("/api/shift-masters", (req, res) => {
    const sql = "SELECT * FROM shift_master";
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error fetching shift masters:", err);
            return res.status(500).json({ message: "Failed to fetch shift masters" });
        }
        res.status(200).json(results);
    });
});

// Add a new Shift Master
app.post("/api/shift-masters", (req, res) => {
    const { shift_name, start_time, end_time } = req.body;

    // Validation
    if (!shift_name || !start_time || !end_time) {
        return res.status(400).json({ message: "All fields are required" });
    }

    const sql = `
        INSERT INTO shift_master (shift_name, start_time, end_time)
        VALUES (?, ?, ?);
    `;
    db.query(sql, [shift_name, start_time, end_time], (err, result) => {
        if (err) {
            console.error("Error adding shift master:", err);
            return res.status(500).json({ message: "Failed to add shift master", error: err });
        }
        res.status(201).json({ message: "Shift master added successfully", shiftId: result.insertId });
    });
});

// Update an existing Shift Master
app.put("/api/shift-masters/:id", (req, res) => {
    const { id } = req.params;
    const { shift_name, start_time, end_time } = req.body;

    // Validation
    if (!shift_name || !start_time || !end_time) {
        return res.status(400).json({ message: "All fields are required" });
    }

    const sql = `
        UPDATE shift_master
        SET shift_name = ?, start_time = ?, end_time = ?
        WHERE shift_id = ?;
    `;
    db.query(sql, [shift_name, start_time, end_time, id], (err, result) => {
        if (err) {
            console.error("Error updating shift master:", err);
            return res.status(500).json({ message: "Failed to update shift master" });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Shift master not found" });
        }
        res.status(200).json({ message: "Shift master updated successfully" });
    });
});

// Delete a Shift Master
app.delete("/api/shift-masters/:id", (req, res) => {
    const { id } = req.params;

    const sql = "DELETE FROM shift_master WHERE shift_id = ?";
    db.query(sql, [id], (err, result) => {
        if (err) {
            console.error("Error deleting shift master:", err);
            return res.status(500).json({ message: "Failed to delete shift master" });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Shift master not found" });
        }
        res.status(200).json({ message: "Shift master deleted successfully" });
    });
});


//*****SHIFT_MAPPING******//
// Utility Function to Format Date
const formatDate = (dateString) => {
    if (!dateString) return null; // Handle empty/null dates
    const date = new Date(dateString);
    return date.toISOString().split("T")[0]; // Format to YYYY-MM-DD
};


// Fetch all shift mappings with shift details
app.get("/api/shift-mappings", (req, res) => {
    const sql = `
        SELECT 
            sm.mapping_id,
            sm.employee_id,
            sm.employee_name,
            sm.shift_id,
            sm.mapping_date,
            sm.shift_start_date,
            sm.shift_end_date,
            s.shift_name,
            s.start_time AS shift_start_time,
            s.end_time AS shift_end_time
        FROM shift_mapping sm
        LEFT JOIN shift_master s ON sm.shift_id = s.shift_id;
    `;
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error fetching shift mappings:", err);
            return res.status(500).json({ message: "Failed to fetch shift mappings" });
        }
        res.status(200).json(results);
    });
});


// Fetch all employees for dropdown
app.get("/api/employees", (req, res) => {
    const sql = "SELECT employee_id, employee_name FROM employees";
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error fetching employees:", err);
            return res.status(500).json({ message: "Failed to fetch employees" });
        }
        res.status(200).json(results);
    });
});

// Fetch all shift masters
app.get("/api/shift-masters", (req, res) => {
    const sql = "SELECT shift_id, shift_name, start_time, end_time FROM shift_master";
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error fetching shift masters:", err);
            return res.status(500).json({ message: "Failed to fetch shift masters" });
        }
        res.status(200).json(results);
    });
});

// Add a new shift mapping
app.post("/api/shift-mappings", (req, res) => {
    let { employee_id, employee_name, shift_id, mapping_date, shift_start_date, shift_end_date } = req.body;

    // Validate inputs
    if (!employee_id || !employee_name || !shift_id || !shift_start_date || !shift_end_date) {
        return res.status(400).json({ message: "All fields are required" });
    }

    mapping_date = formatDate(mapping_date);
    shift_start_date = formatDate(shift_start_date);
    shift_end_date = formatDate(shift_end_date);

    // Fetch shift details
    const fetchShiftDetailsSQL = `
        SELECT shift_name, start_time, end_time 
        FROM shift_master 
        WHERE shift_id = ?;
    `;
    db.query(fetchShiftDetailsSQL, [shift_id], (err, shiftResults) => {
        if (err) {
            console.error("Error fetching shift details:", err);
            return res.status(500).json({ message: "Failed to fetch shift details" });
        }

        if (shiftResults.length === 0) {
            return res.status(404).json({ message: "Shift not found" });
        }

        const { shift_name, start_time, end_time } = shiftResults[0];

        // Insert into shift_mapping
        const insertSQL = `
            INSERT INTO shift_mapping (employee_id, employee_name, shift_id, mapping_date, shift_name, shift_start_time, shift_end_time, shift_start_date, shift_end_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
        `;
        db.query(
            insertSQL,
            [employee_id, employee_name, shift_id, mapping_date, shift_name, start_time, end_time, shift_start_date, shift_end_date],
            (err, result) => {
                if (err) {
                    console.error("Error adding shift mapping:", err);
                    return res.status(500).json({ message: "Failed to add shift mapping" });
                }
                res.status(201).json({ message: "Shift mapping added successfully", mappingId: result.insertId });
            }
        );
    });
});



// Update an existing shift mapping
app.put("/api/shift-mappings/:id", (req, res) => {
    const { id } = req.params;
    let { employee_id, employee_name, shift_id, mapping_date, shift_name, shift_start_time, shift_end_time, shift_start_date, shift_end_date } = req.body;

    if (!employee_id || !employee_name || !shift_id || !mapping_date || !shift_start_date || !shift_end_date) {
        return res.status(400).json({ message: "All fields are required" });
    }

    mapping_date = formatDate(mapping_date);
    shift_start_date = formatDate(shift_start_date);
    shift_end_date = formatDate(shift_end_date);

    const sql = `
        UPDATE shift_mapping
        SET 
            employee_id = ?, 
            employee_name = ?, 
            shift_id = ?, 
            mapping_date = ?, 
            shift_name = ?, 
            shift_start_time = ?, 
            shift_end_time = ?, 
            shift_start_date = ?, 
            shift_end_date = ?
        WHERE mapping_id = ?;
    `;
    db.query(
        sql,
        [employee_id, employee_name, shift_id, mapping_date, shift_name, shift_start_time, shift_end_time, shift_start_date, shift_end_date, id],
        (err, result) => {
            if (err) {
                console.error("Error updating shift mapping:", err);
                return res.status(500).json({ message: "Failed to update shift mapping" });
            }
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: "Shift mapping not found" });
            }
            res.status(200).json({ message: "Shift mapping updated successfully" });
        }
    );
});


// *** DOWNLOAD EXCEL TEMPLATE *** //
// *** DOWNLOAD EXCEL TEMPLATE WITH EXISTING SHIFT DATA *** //
app.get("/api/shift-mappings", (req, res) => {
    const sql = `
        SELECT 
            sm.mapping_id,
            sm.employee_id,
            sm.employee_name,
            sm.shift_id,
            sm.mapping_date,
           COALESCE(sm.shift_start_date, '') AS shift_start_date, 
        COALESCE(sm.shift_end_date, '') AS shift_end_date,
            s.shift_name,
            s.start_time AS shift_start_time,
            s.end_time AS shift_end_time
        FROM shift_mapping sm
        LEFT JOIN shift_master s ON sm.shift_id = s.shift_id;
    `;
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error fetching shift mappings:", err);
            return res.status(500).json({ message: "Failed to fetch shift mappings" });
        }
        res.status(200).json(results);
    });
});





// *** UPLOAD EXCEL FILE *** //

app.post("/api/shift-mappings/upload", upload.single("file"), (req, res) => {
    const file = req.file;

    if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
    }

    try {
        // Read the uploaded Excel file
        const workbook = xlsx.readFile(file.path);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = xlsx.utils.sheet_to_json(worksheet);

        // Utility function to parse dates correctly
        const parseExcelDate = (excelDate) => {
            if (!excelDate || isNaN(excelDate)) return null; // Handle empty or invalid dates
            if (typeof excelDate === "string" && !isNaN(Date.parse(excelDate))) {
                return new Date(excelDate).toISOString().split("T")[0]; // Parse valid string date
            }
            const excelEpoch = new Date(Date.UTC(1899, 11, 30));
            const parsedDate = new Date(excelEpoch.getTime() + (excelDate - 1) * 86400000); // Adjust for Excel's epoch
            return parsedDate.toISOString().split("T")[0];
        };


        // Prepare shift mappings from the uploaded data
        const shiftMappings = data.map((row) => ({
            employee_id: row["Employee ID"],
            employee_name: row["Employee Name"],
            shift_name: row["Shift Name"],
            mapping_date: parseExcelDate(row["Mapping Date"]) || new Date().toISOString().split("T")[0],
            shift_start_date: parseExcelDate(row["Shift Start Date"]),
            shift_end_date: parseExcelDate(row["Shift End Date"]),
        }));

        const fetchShiftDetailsSQL = `
        SELECT shift_id, start_time AS shift_start_time, end_time AS shift_end_time
        FROM shift_master
        WHERE shift_name = ?;
    `;

        const insertSQL = `
    INSERT INTO shift_mapping 
    (employee_id, employee_name, shift_start_time, shift_end_time, shift_id, shift_name, shift_start_date, shift_end_date, mapping_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
`;


        const promises = shiftMappings.map((mapping) => {
            return new Promise((resolve, reject) => {
                if (!mapping.employee_id || !mapping.employee_name || !mapping.shift_name) {
                    console.warn("Skipping invalid row:", mapping);
                    resolve(); // Skip invalid rows
                    return;
                }

                // Fetch shift details based on shift name
                db.query(fetchShiftDetailsSQL, [mapping.shift_name], (err, shiftResults) => {
                    if (err) {
                        console.error("Error fetching shift details:", err);
                        reject(err);
                        return;
                    }

                    if (shiftResults.length === 0) {
                        console.warn(`Shift not found for name: ${mapping.shift_name}`);
                        resolve(); // Skip if shift is not found
                        return;
                    }


                    const { shift_id, shift_start_time, shift_end_time } = shiftResults[0];

                    // Insert shift mapping with fetched details
                    db.query(
                        insertSQL,
                        [
                            mapping.employee_id,
                            mapping.employee_name,
                            shift_start_time || "00:00:00", // Default to "00:00:00" if null
                            shift_end_time || "00:00:00",   // Default to "00:00:00" if null
                            shift_id,
                            mapping.shift_name,
                            mapping.shift_start_date || null,
                            mapping.shift_end_date || null,
                            mapping.mapping_date || null,
                        ],
                        (err) => {
                            if (err) {
                                console.error("Error inserting row into database:", err);
                                reject(err);
                                return;
                            }
                            resolve();
                        }

                    );

                });
            });
        });

        Promise.all(promises)
            .then(() => {
                fs.unlinkSync(file.path); // Delete the temporary file
                res.status(200).json({ message: "Shift mappings uploaded successfully" });
            })
            .catch((error) => {
                console.error("Error processing uploaded file:", error);
                res.status(500).json({ message: "Failed to process uploaded file" });
            });
    } catch (error) {
        console.error("Error processing uploaded file:", error);
        res.status(500).json({ message: "Failed to process uploaded file" });
    }
});





// Delete a shift mapping
app.delete("/api/shift-mappings/:id", (req, res) => {
    const { id } = req.params;

    const sql = "DELETE FROM shift_mapping WHERE mapping_id = ?";
    db.query(sql, [id], (err, result) => {
        if (err) {
            console.error("Error deleting shift mapping:", err);
            return res.status(500).json({ message: "Failed to delete shift mapping" });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Shift mapping not found" });
        }
        res.status(200).json({ message: "Shift mapping deleted successfully" });
    });
});

///*****PAYROLL MASTER */


// Fetch all employees
app.get("/api/employees", (req, res) => {
    const sql = "SELECT employee_id, employee_name FROM employees";
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error fetching employees:", err);
            return res.status(500).json({ message: "Failed to fetch employees." });
        }
        res.status(200).json(results);
    });
});
// Fetch all payroll records
app.get("/api/payroll", (req, res) => {
    const sql = `
      SELECT 
        payroll_id, employee_id, employee_name, category_name, basic_salary, hra, conveyance_allowance, 
        medical_allowance, bonus, special_allowance,  dearness_allowance,shift_allowance,
        city_compensatory_allowance, project_allowance, educational_allowance,
        relocation_allowance,joining_bonus,retention_bonus,project_compensation_bonus, gross_salary, 
        pf_contribution, esi_contribution, income_tax, loan_deduction, unpaid_leave_deduction, penalties, 
        gratuity_contribution,meal_plan_deduction,transport_facility_deduction,attendance_penalty,loss_of_pay,
        deductions, reimbursements, incentives, net_salary, remarks, created_at, updated_at 
      FROM payroll_master
    `;
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error fetching payroll records:", err);
            return res.status(500).json({ message: "Failed to fetch payroll records." });
        }
        res.status(200).json(results);
    });
});



// Fetch all categories
app.get("/api/categories", (req, res) => {
    const sql = "SELECT DISTINCT category_name FROM payroll_mapping";
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error fetching categories:", err);
            return res.status(500).json({ message: "Failed to fetch categories." });
        }
        res.status(200).json(results.map(row => row.category_name));
    });
});

// Fetch payroll columns for a specific category
app.get("/api/category-columns/:category_name", (req, res) => {
    const { category_name } = req.params;
    const sql = `
        SELECT payroll_column_list 
        FROM payroll_mapping 
        WHERE category_name = ?
    `;
    db.query(sql, [category_name], (err, results) => {
        if (err) {
            console.error("Error fetching category columns:", err);
            return res.status(500).json({ message: "Failed to fetch category columns." });
        }
        if (results.length === 0) {
            return res.status(404).json({ message: "Category not found." });
        }
        res.status(200).json(JSON.parse(results[0].payroll_column_list));
    });
});


// Add a new payroll record
app.post("/api/payroll", (req, res) => {
    const {
        employee_id,
        employee_name,
        category_name,
        basic_salary,
        hra = 0,
        conveyance_allowance = 0,
        medical_allowance = 0,
        bonus = 0,
        special_allowance = 0,
        dearness_allowance = 0,
        shift_allowance = 0,
        city_compensatory_allowance = 0,
        project_allowance = 0,
        educational_allowance = 0,
        relocation_allowance = 0,
        joining_bonus = 0,
        retention_bonus = 0,
        project_compensation_bonus = 0,
        pf_contribution = 0,
        esi_contribution = 0,
        income_tax = 0,
        loan_deduction = 0,
        unpaid_leave_deduction = 0,
        penalties = 0,
        gratuity_contribution = 0,
        meal_plan_deduction = 0,
        transport_facility_deduction = 0,
        attendance_penalty = 0,
        loss_of_pay = 0,
        reimbursements = 0,
        incentives = 0,
        remarks = "",
    } = req.body;

    // Validation for required fields
    if (!employee_id || !employee_name || !category_name) {
        return res
            .status(400)
            .json({ message: "Employee ID, Name, and category_name are required." });
    }

    // Calculate gross salary, deductions, and net salary
    const gross_salary =
        parseFloat(basic_salary || 0) +
        parseFloat(hra || 0) +
        parseFloat(conveyance_allowance || 0) +
        parseFloat(medical_allowance || 0) +
        parseFloat(bonus || 0) +
        parseFloat(special_allowance || 0) +
        parseFloat(dearness_allowance || 0) +
        parseFloat(shift_allowance || 0) +
        parseFloat(city_compensatory_allowance || 0) +
        parseFloat(project_allowance || 0) +
        parseFloat(educational_allowance || 0) +
        parseFloat(relocation_allowance || 0) +
        parseFloat(joining_bonus || 0) +
        parseFloat(retention_bonus || 0) +
        parseFloat(project_compensation_bonus || 0);
    const deductions =
        parseFloat(pf_contribution || 0) +
        parseFloat(esi_contribution || 0) +
        parseFloat(income_tax || 0) +
        parseFloat(loan_deduction || 0) +
        parseFloat(unpaid_leave_deduction || 0) +
        parseFloat(penalties || 0) +
        parseFloat(gratuity_contribution || 0) +
        parseFloat(meal_plan_deduction || 0) +
        parseFloat(transport_facility_deduction || 0) +
        parseFloat(attendance_penalty || 0) +
        parseFloat(loss_of_pay || 0);

    const net_salary = gross_salary - deductions;

    // SQL query
    const sql = `
            INSERT INTO payroll_master (
        employee_id, employee_name,category_name, basic_salary, hra, conveyance_allowance,
        medical_allowance, bonus, special_allowance, dearness_allowance, shift_allowance,
        city_compensatory_allowance, project_allowance, educational_allowance,
        relocation_allowance, joining_bonus, retention_bonus, project_compensation_bonus, gross_salary,
        pf_contribution, esi_contribution, income_tax, loan_deduction,
        unpaid_leave_deduction, penalties, gratuity_contribution ,meal_plan_deduction , transport_facility_deduction,
        attendance_penalty,loss_of_pay , deductions, reimbursements,
        incentives, net_salary, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?,?,?,?, ?, ?)
    `;

    db.query(
        sql,
        [

            employee_id,
            employee_name,
            category_name,
            parseFloat(basic_salary || 0),
            parseFloat(hra || 0),
            parseFloat(conveyance_allowance || 0),
            parseFloat(medical_allowance || 0),
            parseFloat(bonus || 0),
            parseFloat(special_allowance || 0),
            parseFloat(dearness_allowance || 0),
            parseFloat(shift_allowance || 0),
            parseFloat(city_compensatory_allowance || 0),
            parseFloat(project_allowance || 0),
            parseFloat(educational_allowance || 0),
            parseFloat(relocation_allowance || 0),
            parseFloat(joining_bonus || 0),
            parseFloat(retention_bonus || 0),
            parseFloat(project_compensation_bonus || 0),
            gross_salary,
            parseFloat(pf_contribution || 0),
            parseFloat(esi_contribution || 0),
            parseFloat(income_tax || 0),
            parseFloat(loan_deduction || 0),
            parseFloat(unpaid_leave_deduction || 0),
            parseFloat(penalties || 0),
            parseFloat(gratuity_contribution || 0),
            parseFloat(meal_plan_deduction || 0),
            parseFloat(transport_facility_deduction || 0),
            parseFloat(attendance_penalty || 0),
            parseFloat(loss_of_pay || 0),

            deductions,
            parseFloat(reimbursements || 0),
            parseFloat(incentives || 0),
            net_salary,
            remarks.trim(),
        ],

        (err, result) => {
            if (err) {
                console.error("Error adding payroll record:", err);
                return res.status(500).json({ message: "Failed to add payroll record." });
            }
            res.status(201).json({ message: "Payroll record added successfully." });
        }
    );
});


// Update an existing payroll record
app.put("/api/payroll/:id", (req, res) => {
    const { id } = req.params;
    const {
        employee_id,
        employee_name,
        category_name,
        basic_salary = 0,
        hra = 0,
        conveyance_allowance = 0,
        medical_allowance = 0,
        bonus = 0,
        special_allowance = 0,
        dearness_allowance = 0,
        shift_allowance = 0,
        city_compensatory_allowance = 0,
        project_allowance = 0,
        educational_allowance = 0,
        relocation_allowance = 0,
        joining_bonus = 0,
        retention_bonus = 0,
        project_compensation_bonus = 0,
        pf_contribution = 0,
        esi_contribution = 0,
        income_tax = 0,
        loan_deduction = 0,
        unpaid_leave_deduction = 0,
        penalties = 0,
        gratuity_contribution = 0,
        meal_plan_deduction = 0,
        transport_facility_deduction = 0,
        attendance_penalty = 0,
        loss_of_pay = 0,
        reimbursements = 0,
        incentives = 0,
        remarks = "",
    } = req.body;

    // Validation for required fields
    if (!employee_id || !employee_name || !category_name) {
        return res
            .status(400)
            .json({ message: "Employee ID, Name, and category_name are required." });
    }

    // Calculate gross salary, deductions, and net salary
    const gross_salary =
        parseFloat(basic_salary || 0) +
        parseFloat(hra || 0) +
        parseFloat(conveyance_allowance || 0) +
        parseFloat(medical_allowance || 0) +
        parseFloat(bonus || 0) +
        parseFloat(special_allowance || 0) +
        parseFloat(dearness_allowance || 0) +
        parseFloat(shift_allowance || 0) +
        parseFloat(city_compensatory_allowance || 0) +
        parseFloat(project_allowance || 0) +
        parseFloat(educational_allowance || 0) +
        parseFloat(relocation_allowance || 0) +
        parseFloat(joining_bonus || 0) +
        parseFloat(retention_bonus || 0) +
        parseFloat(project_compensation_bonus || 0);
    const deductions =
        parseFloat(pf_contribution || 0) +
        parseFloat(esi_contribution || 0) +
        parseFloat(income_tax || 0) +
        parseFloat(loan_deduction || 0) +
        parseFloat(unpaid_leave_deduction || 0) +
        parseFloat(penalties || 0);
    parseFloat(gratuity_contribution || 0);
    parseFloat(meal_plan_deduction || 0);
    parseFloat(transport_facility_deduction || 0);
    parseFloat(attendance_penalty || 0);
    parseFloat(loss_of_pay || 0);




    const net_salary = gross_salary - deductions;

    // SQL query
    const sql = `
      UPDATE payroll_master
      SET 
        employee_id = ?, employee_name = ?, basic_salary = ?, hra = ?, 
        conveyance_allowance = ?, medical_allowance = ?, bonus = ?, 
        special_allowance = ?,dearness_allowance= ?,shift_allowance = ?,
        city_compensatory_allowance = ?, project_allowance = ?, educational_allowance = ?,
        relocation_allowance = ?, joining_bonus = ?, retention_bonus = ?,project_compensation_bonus = ?,
        gross_salary = ?, deductions = ?, pf_contribution = ?, esi_contribution = ?, income_tax = ?, 
        loan_deduction = ?, unpaid_leave_deduction = ?, penalties = ?, gratuity_contribution =?,
    meal_plan_deduction =?,
    transport_facility_deduction=?,
    attendance_penalty=?,
    loss_of_pay =?,
        reimbursements = ?, incentives = ?, net_salary = ?, remarks = ?
      WHERE payroll_id = ?
    `;

    db.query(
        sql,
        [
            employee_id,
            employee_name,
            category_name,
            parseFloat(basic_salary || 0),
            parseFloat(hra || 0),
            parseFloat(conveyance_allowance || 0),
            parseFloat(medical_allowance || 0),
            parseFloat(bonus || 0),
            parseFloat(special_allowance || 0),
            parseFloat(dearness_allowance || 0),
            parseFloat(shift_allowance || 0),
            parseFloat(city_compensatory_allowance || 0),
            parseFloat(project_allowance || 0),
            parseFloat(educational_allowance || 0),
            parseFloat(relocation_allowance || 0),
            parseFloat(joining_bonus || 0),
            parseFloat(retention_bonus || 0),
            parseFloat(project_compensation_bonus || 0),
            gross_salary,
            deductions,
            parseFloat(pf_contribution || 0),
            parseFloat(esi_contribution || 0),
            parseFloat(income_tax || 0),
            parseFloat(loan_deduction || 0),
            parseFloat(unpaid_leave_deduction || 0),
            parseFloat(penalties || 0),
            parseFloat(gratuity_contribution || 0),
            parseFloat(meal_plan_deduction || 0),
            parseFloat(transport_facility_deduction || 0),
            parseFloat(attendance_penalty || 0),
            parseFloat(loss_of_pay || 0),
            parseFloat(reimbursements || 0),
            parseFloat(incentives || 0),
            net_salary,
            remarks.trim(),
            id,
        ],
        (err, result) => {
            if (err) {
                console.error("Error updating payroll record:", err);
                return res
                    .status(500)
                    .json({ message: "Failed to update payroll record." });
            }
            if (result.affectedRows === 0) {
                return res.status(404).json({ message: "Payroll record not found." });
            }
            res.status(200).json({ message: "Payroll record updated successfully." });
        }
    );
});

//**UPLOAD EXCEL TEMPLATE  */
// Sample endpoint to handle payroll data upload
router.post("/api/upload-payroll-data", async (req, res) => {
    const { payrollData } = req.body;

    if (!payrollData || !Array.isArray(payrollData)) {
        return res.status(400).json({ error: "Invalid data format" });
    }

    try {
        for (const record of payrollData) {
            console.log("Saving record:", record);
            // Add DB save logic here
        }

        res.status(200).json({ message: "Data uploaded successfully!" });
    } catch (err) {
        console.error("Error saving data:", err);
        res.status(500).json({ error: "Failed to save payroll data" });
    }
});





// Delete a payroll record
app.delete("/api/payroll/:id", (req, res) => {
    const { id } = req.params;

    const sql = "DELETE FROM payroll_master WHERE payroll_id = ?";

    db.query(sql, [id], (err, result) => {
        if (err) {
            console.error("Error deleting payroll record:", err);
            return res.status(500).json({ message: "Failed to delete payroll record." });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Payroll record not found." });
        }
        res.status(200).json({ message: "Payroll record deleted successfully." });
    });
});

//***PAYROLL MAPPING */

// API to fetch column headers from payroll_master
app.get("/api/headers", (req, res) => {
    const sql = `
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'payroll_master' AND TABLE_SCHEMA = 'attendance_system'
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error fetching headers:", err);
            return res.status(500).json({ message: "Failed to fetch headers" });
        }

        // Extract column names
        const headers = results.map((row) => row.COLUMN_NAME);
        res.json(headers);
    });
});

// API to fetch existing category mappings
app.get("/api/mappings", (req, res) => {
    const sql = `SELECT category_name, payroll_column_list, created_at FROM payroll_mapping`;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error fetching mappings:", err);
            return res.status(500).json({ message: "Failed to fetch mappings" });
        }

        // Ensure data is sent in the correct format
        res.json(results);
    });
});




// API to save payroll mapping
app.post("/api/save-mapping", (req, res) => {
    const { categoryName, payrollColumnList } = req.body;

    // Validate input
    if (
        !categoryName ||
        typeof categoryName !== "string" ||
        !categoryName.trim() ||
        !payrollColumnList ||
        !Array.isArray(JSON.parse(payrollColumnList)) ||
        JSON.parse(payrollColumnList).length === 0
    ) {
        return res.status(400).json({
            message: "Category name and payroll column list are required",
        });
    }

    // Prepare the SQL query
    const sql = `
        INSERT INTO payroll_mapping (category_name, payroll_column_list, created_at, updated_at)
        VALUES (?, ?, NOW(), NOW())
    `;

    // Execute the query
    db.query(sql, [categoryName.trim(), payrollColumnList], (err, results) => {
        if (err) {
            console.error("Error saving mapping:", err);
            return res.status(500).json({ message: "Failed to save mapping" });
        }

        res.json({ message: "Mapping saved successfully", data: results });
    });
});


// Update an existing mapping
app.put("/api/mappings/:id", (req, res) => {
    const { id } = req.params;
    const { categoryName, payrollColumnList } = req.body;

    if (!categoryName || !payrollColumnList) {
        return res.status(400).json({ message: "Category name and payroll column list are required" });
    }

    const sql = `
        UPDATE payroll_mapping
        SET category_name = ?, payroll_column_list = ?
        WHERE id = ?
    `;

    db.query(sql, [categoryName, payrollColumnList, id], (err, results) => {
        if (err) {
            console.error("Error updating mapping:", err);
            return res.status(500).json({ message: "Failed to update mapping" });
        }

        res.json({ message: "Mapping updated successfully" });
    });
});






//****ORGANIZE ATTENDANCE DATA */

// Multer configuration for file uploads
//const upload = multer({ dest: "uploads/" });

// Function to convert Excel time to HH:mm format
const convertExcelTime = (excelTime) => {
    if (!excelTime) return "00:00"; // Default value for missing time
    const totalMinutes = Math.round(excelTime * 24 * 60); // Convert fractional day to minutes
    const hours = Math.floor(totalMinutes / 60).toString().padStart(2, "0");
    const minutes = (totalMinutes % 60).toString().padStart(2, "0");
    return `${hours}:${minutes}`;
};

// Function to calculate time difference
const calculateTimeDifference = (expected, actual) => {
    const [expectedHours, expectedMinutes] = expected.split(":").map(Number);
    const [actualHours, actualMinutes] = actual.split(":").map(Number);

    const expectedTotalMinutes = expectedHours * 60 + expectedMinutes;
    const actualTotalMinutes = actualHours * 60 + actualMinutes;

    const diffMinutes = Math.max(0, actualTotalMinutes - expectedTotalMinutes);

    const hours = Math.floor(diffMinutes / 60).toString().padStart(2, "0");
    const minutes = (diffMinutes % 60).toString().padStart(2, "0");

    return `${hours}:${minutes}`;
};

// Fetch shift details for an employee
const getEmployeeShiftDetails = async (employeeId) => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT sm.shift_name, sm.start_time AS start_time, sm.end_time AS end_time
            FROM attendance_system.shift_mapping m
            JOIN attendance_system.shift_master sm ON m.shift_id = sm.shift_id
            WHERE m.employee_id = ?`;
        db.query(query, [employeeId], (err, result) => {
            if (err) {
                return reject(err);
            }
            resolve(result[0] || { shift_name: "N/A", start_time: "00:00", end_time: "08:00" });
        });
    });
};

// Fetch all shift options for dropdown
const getAllShifts = async () => {
    return new Promise((resolve, reject) => {
        const query = `SELECT shift_id, shift_name, start_time FROM attendance_system.shift_master`;
        db.query(query, (err, results) => {
            if (err) {
                return reject(err);
            }
            resolve(results || []);
        });
    });
};

// Function to calculate time difference (returns "On Time" if negative)
const calculateLateBy = (expected, actual) => {
    const [expectedHours, expectedMinutes] = expected.split(":").map(Number);
    const [actualHours, actualMinutes] = actual.split(":").map(Number);

    const expectedTotalMinutes = expectedHours * 60 + expectedMinutes;
    const actualTotalMinutes = actualHours * 60 + actualMinutes;

    const diffMinutes = actualTotalMinutes - expectedTotalMinutes;

    if (diffMinutes <= 0) return "On Time"; // If the difference is negative or zero

    const hours = Math.floor(diffMinutes / 60).toString().padStart(2, "0");
    const minutes = (diffMinutes % 60).toString().padStart(2, "0");

    return `${hours}:${minutes}`;
};
// Calculate OT Hours
const calculateOTHours = (endTime, outTime) => {
    const [endHours, endMinutes] = endTime.split(":").map(Number);
    const [outHours, outMinutes] = outTime.split(":").map(Number);

    const endTotalMinutes = endHours * 60 + endMinutes;
    const outTotalMinutes = outHours * 60 + outMinutes;

    if (outTotalMinutes > endTotalMinutes) {
        const diffMinutes = outTotalMinutes - endTotalMinutes;
        const hours = Math.floor(diffMinutes / 60).toString().padStart(2, "0");
        const minutes = (diffMinutes % 60).toString().padStart(2, "0");
        return `${hours}:${minutes}`;
    }

    return "00:00"; // Default if no OT
};

// Calculate Final OT Hours based on logic
const calculateFinalOTHours = (otHours) => {
    const [hours, minutes] = otHours.split(":").map(Number);

    if (minutes >= 55) {
        return (hours + 1).toFixed(1);
    } else if (minutes >= 30) {
        return (hours + 0.5).toFixed(1);
    }
    return hours.toFixed(1);
};

// Calculate OT Hours (subtract Late By if applicable)
const calculateOTHoursWithLateBy = (endTime, outTime, lateBy) => {
    const [endHours, endMinutes] = endTime.split(":").map(Number);
    const [outHours, outMinutes] = outTime.split(":").map(Number);

    const endTotalMinutes = endHours * 60 + endMinutes;
    const outTotalMinutes = outHours * 60 + outMinutes;

    if (outTotalMinutes > endTotalMinutes) {
        let diffMinutes = outTotalMinutes - endTotalMinutes;

        // Subtract Late By if it's not "On Time"
        if (lateBy !== "On Time") {
            const [lateHours, lateMinutes] = lateBy.split(":").map(Number);
            const lateTotalMinutes = lateHours * 60 + lateMinutes;
            diffMinutes -= lateTotalMinutes;
        }

        // Ensure OT Hours doesn't go negative
        diffMinutes = Math.max(0, diffMinutes);

        const hours = Math.floor(diffMinutes / 60).toString().padStart(2, "0");
        const minutes = (diffMinutes % 60).toString().padStart(2, "0");

        const otHours = `${hours}:${minutes}`;
        return {
            otHours,
            finalOTHours: calculateFinalOTHours(otHours), // Calculate Final OT Hours
        };
    }

    return { otHours: "00:00", finalOTHours: "0.0" }; // Default if no OT
};

const calculatePresentDays = (inTime, outTime) => {
    if (inTime === "00:00" && outTime === "00:00") {
        return 0; // Both In Time and Out Time are 00:00
    }

    if (inTime !== "00:00" && outTime === "00:00") {
        return 0.5; // In Time exists but Out Time is 00:00
    }

    const [inHours, inMinutes] = inTime.split(":").map(Number);
    const [outHours, outMinutes] = outTime.split(":").map(Number);

    const inTotalMinutes = inHours * 60 + inMinutes;
    const outTotalMinutes = outHours * 60 + outMinutes;

    const durationMinutes = outTotalMinutes - inTotalMinutes;

    if (durationMinutes >= 480) { // 8 hours
        return 1;
    } else if (durationMinutes >= 240) { // 4 hours
        return 0.5;
    }

    return 0; // Less than 4 hours
};

// Consolidate Attendance Data
app.post("/api/consolidate-attendance", async (req, res) => {
    const { year, month, location_name, organizedData } = req.body;

    if (!year || !month || !location_name || !organizedData) {
        return res.status(400).send("Year, Month, Location, and Organized Data are required.");
    }

    if (typeof location_name !== "string") {
        return res.status(400).send("Invalid location name. It must be a string.");
    }

    try {
        // Aggregate data by employee_id
        const consolidatedData = organizedData.reduce((acc, row) => {
            const key = `${row.empCode}-${row.empName}`;
            if (!acc[key]) {
                acc[key] = {
                    employee_id: row.empCode,
                    employee_name: row.empName,
                    month,
                    year,
                    total_present_days: 0,
                    total_ot_hours: 0,
                    location_name,
                };
            }
            acc[key].total_present_days += row.presentDays || 0;
            acc[key].total_ot_hours += parseFloat(row.finalOTHours || 0);
            return acc;
        }, {});

        const values = Object.values(consolidatedData).map((row) => [
            row.employee_id,
            row.employee_name,
            row.month,
            row.year,
            row.total_present_days,
            row.total_ot_hours,
            row.location_name,
        ]);

        // Delete existing data for the same month and year
        const deleteQuery = `
            DELETE FROM attendance_system.consolidated_attendance_data
            WHERE month = ? AND year = ?
        `;
        await new Promise((resolve, reject) => {
            db.query(deleteQuery, [month, year], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Insert new data
        const insertQuery = `
            INSERT INTO attendance_system.consolidated_attendance_data
            (employee_id, employee_name, month, year, total_present_days, total_ot_hours, location_name)
            VALUES ?
        `;
        await new Promise((resolve, reject) => {
            db.query(insertQuery, [values], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        res.status(200).json({
            message: "Attendance data consolidated successfully.",
            consolidatedData: Object.values(consolidatedData),
        });
    } catch (error) {
        console.error("Error consolidating attendance data:", error);
        res.status(500).send("Failed to consolidate attendance data.");
    }
});

// Endpoint to fetch location names
app.get("/api/locations", async (req, res) => {
    try {
        const query = "SELECT id, name FROM attendance_system.locations";
        db.query(query, (err, results) => {
            if (err) {
                console.error("Error fetching locations:", err);
                res.status(500).send("Failed to fetch locations.");
            } else {
                res.status(200).json(results); // Ensure it sends an array
            }
        });
    } catch (error) {
        console.error("Server error:", error);
        res.status(500).send("Server error.");
    }
});


// Organize attendance data
app.post("/api/organize-attendance", upload.single("file"), async (req, res) => {


    const { year, month, location_name, organizedData } = req.body;
    const file = req.file;
    if (!location_name) {
        return res.status(400).send("Location Name is required.");
    }


    if (!file || !year || !month || !location_name) {
        return res.status(400).send("Year, Month, File, and Location are required.");
    }

    try {
        const workbook = xlsx.readFile(file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

        const output = [];
        const shifts = await getAllShifts();

        for (let row = 0; row < data.length; row++) {
            if (["Employee:"].includes(data[row][0])) {
                const employeeDetails = data[row][3];
                if (!employeeDetails || !employeeDetails.includes(":")) continue;

                const [empCode, empName] = employeeDetails.split(":").map((e) => e.trim());
                const inTimeRow = row + 2;
                const outTimeRow = row + 3;
                const daysRow = data[6];

                const employeeShiftDetails = await getEmployeeShiftDetails(empCode);

                for (let col = 2; col < daysRow.length; col++) {
                    const date = daysRow[col];
                    if (!date) continue;

                    const inTimeRaw = data[inTimeRow]?.[col] || "00:00";
                    const outTimeRaw = data[outTimeRow]?.[col] || "00:00";
                    const inTime = isNaN(inTimeRaw) ? inTimeRaw : convertExcelTime(inTimeRaw);
                    const outTime = isNaN(outTimeRaw) ? outTimeRaw : convertExcelTime(outTimeRaw);

                    // Calculate Present Days
                    const presentDays = calculatePresentDays(inTime, outTime);

                    const lateBy = calculateLateBy(employeeShiftDetails.start_time, inTime);
                    const { otHours, finalOTHours } = calculateOTHoursWithLateBy(
                        employeeShiftDetails.end_time,
                        outTime,
                        lateBy
                    );

                    output.push({
                        empCode,
                        empName,
                        date,
                        inTime,
                        outTime,
                        presentDays,
                        shiftName: employeeShiftDetails.shift_name,
                        lateBy,
                        otHours,
                        finalOTHours,
                    });
                }
            }
        }



        fs.unlinkSync(file.path);

        res.status(200).json({
            message: "Attendance data organized successfully.",
            data: output,
        });
    } catch (error) {
        console.error("Error organizing attendance data:", error);
        res.status(500).send("Failed to organize attendance data.");
    }
});



// Endpoint to fetch shift options for dropdown
app.get("/api/shifts", async (req, res) => {
    try {
        const shifts = await getAllShifts();
        res.status(200).json(shifts);
    } catch (err) {
        console.error("Error fetching shifts:", err);
        res.status(500).send("Failed to fetch shifts.");
    }
});

// Fetch shift details including start and end times
app.put("/api/update-shift-change", async (req, res) => {
    const { shift_id } = req.body;

    if (!shift_id) {
        return res.status(400).send("Shift ID is required.");
    }

    try {
        // Fetch new shift start_time and end_time
        const query = `SELECT start_time, end_time FROM attendance_system.shift_master WHERE shift_id = ?`;
        const [shiftDetails] = await new Promise((resolve, reject) => {
            db.query(query, [shift_id], (err, results) => {
                if (err) reject(err);
                else resolve(results);
            });
        });

        if (!shiftDetails) {
            return res.status(404).send("Shift not found.");
        }

        const { start_time: newStartTime, end_time: newEndTime } = shiftDetails;

        // Return the new shift details for frontend calculations
        res.status(200).json({ start_time: newStartTime, end_time: newEndTime });
    } catch (error) {
        console.error("Error fetching shift details:", error);
        res.status(500).send("Failed to fetch shift details.");
    }
});



// Fetch contractors by location_id
app.get('/api/contractors/by-location', (req, res) => {
    const { location_id } = req.query;

    if (!location_id) {
        return res.status(400).json({ message: 'location_id is required' });
    }

    const sql = `
        SELECT 
            c.contractor_id, 
            c.contractor_name, 
            c.contact_number, 
            c.contractor_email, 
            c.location_id, 
            c.created_by
        FROM contractors c
        WHERE c.location_id = ?
    `;

    db.query(sql, [location_id], (err, results) => {
        if (err) {
            console.error('Error fetching contractors by location:', err);
            return res.status(500).json({ message: 'Failed to fetch contractors by location' });
        }

        if (results.length === 0) {
            return res.status(404).json({ message: 'No contractors found for the selected location' });
        }

        res.status(200).json(results);
    });
});


///*** CONSOLIDATE ATTENDANCE DATA */

app.get("/api/consolidated-attendance-data", async (req, res) => {
    const query = `SELECT year, month, employee_id, employee_name, total_present_days, total_ot_hours FROM attendance_system.consolidated_attendance_data`;
    db.query(query, (err, results) => {
        if (err) {
            console.error("Error fetching data:", err);
            res.status(500).send("Failed to fetch attendance data.");
        } else {
            res.status(200).json(results);
        }
    });
});



const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

// Set up Google Sheets API client
const auth = new GoogleAuth({
    keyFile: 'key/service-account-key.json', // Replace with the path to your service account JSON
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });

const SHEET_ID = '1p8BrcntYJUkqjdSY8AEdpyNiOn9mEiXTmEKb2gWMqMw'; // Replace with your sheet ID
const ORGANIZED_ATTENDANCE_RANGE = 'Contractors'; // Sheet name for attendance data

app.get('/api/attendance', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: ORGANIZED_ATTENDANCE_RANGE,
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return res.status(404).json({ message: 'No data found in the attendance sheet' });
        }

        // Extract headers and data
        const headers = rows[0]; // First row as headers
        const data = rows.slice(1).map((row) =>
            headers.reduce((acc, header, index) => {
                acc[header] = row[index] || null;
                return acc;
            }, {})
        );

        res.status(200).json(data);
    } catch (error) {
        console.error('Error fetching attendance data:', error);
        res.status(500).json({ message: 'Failed to fetch attendance data' });
    }
});

////*** PAYROLL_PROCESSING */
// Process payroll data

app.post("/api/process-payroll", (req, res) => {
    const { year, month } = req.body;

    if (!year || !month) {
        return res
            .status(400)
            .json({ success: false, message: "Year and Month are required." });
    }

    // Calculate the total days in the selected month and year
    const monthIndex = new Date(`${month} 1, ${year}`).getMonth(); // Get zero-based month index
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate(); // Calculate days in the month

    // Function to calculate the number of Sundays in the selected month and year
    const calculateSundays = (year, monthIndex) => {
        let date = new Date(year, monthIndex, 1);
        let sundays = 0;
        while (date.getMonth() === monthIndex) {
            if (date.getDay() === 0) sundays++; // Check if it's a Sunday
            date.setDate(date.getDate() + 1);
        }
        return sundays;
    };

    const weekends = calculateSundays(year, monthIndex); // Calculate the number of Sundays

    const sqlFetch = `
      SELECT 
        ca.employee_id,
        ca.employee_name,
        ca.total_present_days,
        ca.total_ot_hours,
        pm.basic_salary,
        pm.hra,
        pm.conveyance_allowance,
        pm.medical_allowance,
        pm.bonus,
        pm.special_allowance,
        pm.pf_contribution,
        pm.esi_contribution,
        pm.income_tax,
        pm.loan_deduction,
        pm.unpaid_leave_deduction,
        pm.penalties,
        pm.deductions,
        pm.reimbursements,
        pm.incentives,
        pm.remarks
      FROM 
        consolidated_attendance_data ca
      INNER JOIN 
        payroll_master pm
      ON 
        ca.employee_id = pm.employee_id
      WHERE 
        ca.month = ? AND ca.year = ?`;

    db.query(sqlFetch, [month, year], (err, results) => {
        if (err) {
            console.error("Error fetching payroll data:", err);
            return res
                .status(500)
                .json({ success: false, message: "Failed to fetch payroll data." });
        }

        if (results.length === 0) {
            console.log("No data found for the selected month and year.");
            return res.status(404).json({
                success: false,
                message: "No payroll data found for the selected month and year.",
            });
        }

        // Map the processed payroll data with corrected logic
        const processedPayrollData = results.map((record) => {
            // Ensure all optional fields are numbers
            const medicalAllowance = parseFloat(record.medical_allowance || 0);
            const bonus = parseFloat(record.bonus || 0);
            const pfContribution = parseFloat(record.pf_contribution || 0);
            const esiContribution = parseFloat(record.esi_contribution || 0);
            const incomeTax = parseFloat(record.income_tax || 0);
            const loanDeduction = parseFloat(record.loan_deduction || 0);
            const unpaidLeaveDeduction = parseFloat(record.unpaid_leave_deduction || 0);
            const penalties = parseFloat(record.penalties || 0);

            // Total Present Days
            const totalPresentDays = parseFloat(record.total_present_days || 0);

            // Correctly calculate Payable Days
            const payableDays = totalPresentDays + weekends;

            // Proportional calculations for Basic Salary, HRA, Conveyance Allowance, and Special Allowance
            const proportionalFactor = payableDays / daysInMonth;

            const calculatedBasicSalary = parseFloat(record.basic_salary || 0) * proportionalFactor;
            const calculatedHRA = parseFloat(record.hra || 0) * proportionalFactor;
            const calculatedConveyanceAllowance =
                parseFloat(record.conveyance_allowance || 0) * proportionalFactor;
            const calculatedSpecialAllowance =
                parseFloat(record.special_allowance || 0) * proportionalFactor;

            // Calculate Gross Salary
            const grossSalary =
                calculatedBasicSalary +
                calculatedHRA +
                calculatedConveyanceAllowance +
                medicalAllowance +
                bonus +
                calculatedSpecialAllowance;

            // Calculate Total Deductions
            const totalDeductions =
                pfContribution +
                esiContribution +
                incomeTax +
                loanDeduction +
                unpaidLeaveDeduction +
                penalties;

            // Ensure `deductions` matches `totalDeductions`
            const deductions = totalDeductions.toFixed(2);

            // Calculate Net Salary
            const netSalary = grossSalary - totalDeductions;

            return {
                ...record,
                basic_salary: calculatedBasicSalary.toFixed(2),
                hra: calculatedHRA.toFixed(2),
                conveyance_allowance: calculatedConveyanceAllowance.toFixed(2),
                special_allowance: calculatedSpecialAllowance.toFixed(2),
                gross_salary: grossSalary.toFixed(2),
                deductions, // Explicitly set deductions
                net_salary: netSalary.toFixed(2),
                month,
                year,
                month_days: daysInMonth,
                weekend: weekends, // Add weekends
                payable_days: payableDays.toFixed(2), // Corrected Payable Days
            };
        });

        // Save the processed payroll data into the database
        const sqlInsert = `
        INSERT INTO payroll_processing 
        (employee_id, employee_name, month, year, month_days, weekend, total_present_days, 
         total_ot_hours, payable_days, basic_salary, hra, conveyance_allowance, medical_allowance, 
         bonus, special_allowance, gross_salary, pf_contribution, esi_contribution, income_tax, 
         loan_deduction, unpaid_leave_deduction, penalties, deductions, reimbursements, 
         incentives, net_salary, remarks) 
        VALUES ?`;

        const values = processedPayrollData.map((record) => [
            record.employee_id,
            record.employee_name,
            record.month,
            record.year,
            record.month_days,
            record.weekend,
            record.total_present_days,
            record.total_ot_hours,
            record.payable_days,
            record.basic_salary,
            record.hra,
            record.conveyance_allowance,
            record.medical_allowance,
            record.bonus,
            record.special_allowance,
            record.gross_salary,
            record.pf_contribution,
            record.esi_contribution,
            record.income_tax,
            record.loan_deduction,
            record.unpaid_leave_deduction,
            record.penalties,
            record.deductions,
            record.reimbursements,
            record.incentives,
            record.net_salary,
            record.remarks,
        ]);

        db.query(sqlInsert, [values], (err, result) => {
            if (err) {
                console.error("Error saving payroll data:", err);
                return res
                    .status(500)
                    .json({ success: false, message: "Failed to save payroll data." });
            }

            res.status(200).json({
                success: true,
                message: "Payroll data processed and saved successfully.",
                data: processedPayrollData,
            });
        });
    });
});








////***PAYSLIP GENERATION */



// Nodemailer Configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// Endpoint to Generate and Send Payslip
// Fetch employee data and send payslip as PDF
app.post('/api/send-payslip', async (req, res) => {
    const { month, year } = req.body;

    try {
        const query = `
            SELECT 
                pp.employee_id, pp.employee_name, pp.basic_salary, pp.hra, pp.conveyance_allowance,
                pp.special_allowance, pp.total_ot_hours, pp.gross_salary, pp.pf_contribution, 
                pp.esi_contribution, pp.income_tax, pp.loan_deduction, pp.unpaid_leave_deduction, 
                pp.penalties, pp.deductions, pp.net_salary, pp.reimbursements, pp.incentives, 
                e.education AS email_id
            FROM payroll_processing pp
            INNER JOIN employees e ON pp.employee_id = e.employee_id
            WHERE pp.month = ? AND pp.year = ?
        `;

        db.query(query, [month, year], (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Error fetching data');
            }

            if (results.length === 0) {
                return res.status(404).send('No payroll data found for the specified month and year.');
            }

            results.forEach((employee) => {
                // Create PDF
                const doc = new PDFDocument();
                const filePath = path.join(__dirname, `payslip-${employee.employee_id}-${month}-${year}.pdf`);
                doc.pipe(fs.createWriteStream(filePath));

                // Header
                doc.image(path.join(__dirname, 'path', 'logo.png'), { width: 80, align: 'center' })

                    .fontSize(20)
                    .text('PAY SLIP', { align: 'center' })
                    .moveDown();

                // Employee Details
                doc.fontSize(12)
                    .text(`Employee Name: ${employee.employee_name}`)
                    .text(`Designation: ${employee.designation}`)
                    .text(`Employee ID: ${employee.employee_id}`)
                    .text(`Payslip for the Month: ${month} ${year}`)
                    .moveDown();

                // Salary Details
                doc.fontSize(14).text('Pay Elements', { underline: true });
                doc.fontSize(12)
                    .text(`Basic Salary: ₹${employee.basic_salary}`)
                    .text(`HRA: ₹${employee.hra}`)
                    .text(`Conveyance Allowance: ₹${employee.conveyance_allowance}`)
                    .text(`Special Allowance: ₹${employee.special_allowance}`)
                    .text(`OT: ₹${employee.total_ot_hours}`)
                    .moveDown();

                // Deductions
                doc.fontSize(14).text('Deductions', { underline: true });
                doc.fontSize(12)
                    .text(`PF Contribution: ₹${employee.pf_contribution}`)
                    .text(`ESI Contribution: ₹${employee.esi_contribution}`)
                    .text(`Income Tax: ₹${employee.income_tax}`)
                    .text(`Loan Deduction: ₹${employee.loan_deduction}`)
                    .text(`Unpaid Leave Deduction: ₹${employee.unpaid_leave_deduction}`)
                    .text(`Penalties: ₹${employee.penalties}`)
                    .text(`Total Deductions: ₹${employee.deductions}`)
                    .moveDown();

                // Final Amount
                doc.fontSize(14).text('Net Payable', { underline: true });
                doc.fontSize(12)
                    .text(`Gross Salary: ₹${employee.gross_salary}`)
                    .text(`Reimbursements: ₹${employee.reimbursements}`)
                    .text(`Incentives: ₹${employee.incentives}`)
                    .text(`Net Salary: ₹${employee.net_salary}`)
                    .moveDown();

                // Footer
                doc.fontSize(10)
                    .text('This is a computer-generated payslip and does not require a signature.', { align: 'center' });

                doc.end();

                // Send Email
                const emailContent = `
                    <h3>Payslip for the Month: ${month} ${year}</h3>
                    <p>Dear ${employee.employee_name},</p>
                    <p>Please find attached your payslip for the month of ${month} ${year}.</p>
                    <p>Thank you.</p>
                `;

                transporter.sendMail(
                    {
                        from: process.env.EMAIL_USER,
                        to: employee.email_id,
                        subject: `Payslip for ${month} ${year}`,
                        html: emailContent,
                        attachments: [
                            {
                                filename: `Payslip-${employee.employee_id}-${month}-${year}.pdf`,
                                path: filePath,
                            },
                        ],
                    },
                    (error, info) => {
                        if (error) {
                            console.error(`Error sending email to ${employee.email_id}:`, error);
                        } else {
                            console.log(`Email sent to ${employee.email_id}:`, info.response);

                            // Update Status
                            const updateQuery = `
                                UPDATE payroll_processing 
                                SET status = 'Sent' 
                                WHERE employee_id = ? AND month = ? AND year = ?
                            `;
                            db.query(updateQuery, [employee.employee_id, month, year]);
                        }
                    }
                );
            });

            res.send('Payslips processed and emails sent successfully.');
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal server error');
    }
});


///*** LEAVE MANAGEMENTENT */

// 1. Fetch All Leave Requests
app.get("/api/leave-requests", (req, res) => {
    const query = "SELECT * FROM leave_requests";
    db.query(query, (err, results) => {
        if (err) {
            console.error("Database Error:", err);
            return res.status(500).json({ error: "Failed to fetch leave requests" });
        }
        res.status(200).json(results);
    });
});

// 2. Fetch Specific User (for Login/Authorization)
app.get("/api/users/me", (req, res) => {
    const email = req.query.email; // Use query param for email
    if (!email) {
        return res.status(400).json({ error: "Email is required" });
    }

    const query = "SELECT email, role FROM users WHERE email = ?";
    db.query(query, [email], (err, results) => {
        if (err) {
            console.error("Database Error:", err);
            return res.status(500).json({ error: "Failed to fetch user details" });
        }
        if (results.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }
        res.status(200).json(results[0]);
    });
});

// 3. Save New Leave Request
app.post("/api/leave-requests", (req, res) => {
    const {
        employee_id,
        employee_name,
        leave_type,
        leave_start_date,
        leave_end_date,
        leave_reason,
        created_by,
    } = req.body;

    // Validate Required Fields
    if (
        !employee_id ||
        !employee_name ||
        !leave_type ||
        !leave_start_date ||
        !leave_end_date ||
        !created_by
    ) {
        return res.status(400).json({ error: "All required fields must be provided" });
    }

    // Calculate Leave Duration
    const leave_duration =
        Math.ceil(
            (new Date(leave_end_date) - new Date(leave_start_date)) /
            (1000 * 60 * 60 * 24)
        ) + 1;

    const query = `
      INSERT INTO leave_requests 
      (employee_id, employee_name, leave_type, leave_start_date, leave_end_date, leave_duration, leave_reason, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(
        query,
        [
            employee_id,
            employee_name,
            leave_type,
            leave_start_date,
            leave_end_date,
            leave_duration,
            leave_reason || null,
            "Pending", // Default status
            created_by,
        ],
        (err, results) => {
            if (err) {
                console.error("Database Error:", err);
                return res.status(500).json({ error: "Failed to create leave request" });
            }
            res.status(201).json({
                message: "Leave request created successfully",
                leave_id: results.insertId,
            });
        }
    );
});

// 4. Update Status of a Leave Request (Approve/Reject)
app.put("/api/leave-requests/:id", (req, res) => {
    const { id } = req.params;
    const { status, role, email } = req.body;

    // Validate Input
    if (!status || !role || !email) {
        return res
            .status(400)
            .json({ error: "Status, role, and email are required" });
    }

    const query = `
      UPDATE leave_requests 
      SET status = ?, updated_at = NOW() 
      WHERE leave_id = ?
    `;

    db.query(query, [status, id], (err, results) => {
        if (err) {
            console.error("Database Error:", err);
            return res.status(500).json({ error: "Failed to update leave request" });
        }
        if (results.affectedRows === 0) {
            return res.status(404).json({ error: "Leave request not found" });
        }
        res.status(200).json({ message: `Leave request ${status.toLowerCase()} successfully` });
    });
});

// 5. Fetch All Employees (Optional for Dropdown)
app.get("/api/employees", (req, res) => {
    const query = "SELECT employee_id, employee_name FROM employees";
    db.query(query, (err, results) => {
        if (err) {
            console.error("Database Error:", err);
            return res.status(500).json({ error: "Failed to fetch employees" });
        }
        res.status(200).json(results);
    });
});


app.get("/api/leave-requests", (req, res) => {
    const { email, role } = req.query;

    const query = role === "Employee"
        ? `SELECT * FROM leave_requests WHERE created_by = ?`
        : `SELECT * FROM leave_requests`;

    db.query(query, [email], (err, results) => {
        if (err) {
            console.error("Error fetching leave requests:", err);
            return res.status(500).json({ error: "Failed to fetch leave requests" });
        }
        res.status(200).json(results);
    });
});





////*** Permission Management */


// ==================== PERMISSIONS API ====================
// Get all permissions
app.get("/api/permissions", (req, res) => {
    const { email } = req.query;
    const sql = email
        ? "SELECT * FROM permissions WHERE created_by = ?"
        : "SELECT * FROM permissions";
    const params = email ? [email] : [];

    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Create a new permission
app.post("/api/permissions", (req, res) => {
    const {
        employee_id,
        employee_name,
        permission_date,
        permission_hours,
        permission_start_time,
        permission_end_time,
        created_by,
    } = req.body;

    if (!employee_id || !employee_name || !permission_date || !permission_hours || !permission_start_time || !permission_end_time || !created_by) {
        return res.status(400).json({ error: "All fields are required" });
    }

    const sql = `
      INSERT INTO permissions (employee_id, employee_name, permission_date, permission_hours, permission_start_time, permission_end_time, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?)
    `;

    db.query(sql, [employee_id, employee_name, permission_date, permission_hours, permission_start_time, permission_end_time, created_by], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Permission created successfully", permission_id: result.insertId });
    });
});


// Approve or Reject Permission
app.put("/api/permissions/:id", (req, res) => {
    const { id } = req.params;
    const { status, email } = req.body;

    if (!status || (status !== "Approved" && status !== "Rejected")) {
        return res.status(400).json({ error: "Valid status required (Approved/Rejected)" });
    }

    const sql = "UPDATE permissions SET status = ? WHERE id = ?";
    db.query(sql, [status, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        res.json({ message: `Permission request ${status.toLowerCase()} successfully` });
    });
});




////*****SERVVER RUN BELOW CODE */
// Start HTTP Server
const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// WebSocket Server
const wss = new WebSocketServer({ server });

let clients = [];

// Handle WebSocket connections
wss.on('connection', (ws) => {
    clients.push(ws);
    console.log('New WebSocket connection');

    ws.on('close', () => {
        clients = clients.filter((client) => client !== ws);
        console.log('WebSocket connection closed');
    });
});

// Broadcast messages to all connected clients
function broadcastToClients(message) {
    clients.forEach((client) => {
        if (client.readyState === 1) {
            client.send(message);
        }
    });
}

// const express = require("express");
// const fileUpload = require("express-fileupload");
// const xlsx = require("xlsx");
// const path = require("path");
// const fs = require("fs");

// const app = express();
// const PORT = 3000;
// const cors = require("cors");

// app.use(cors());

// // Middleware for file upload
// app.use(fileUpload());

// // POST route to handle file upload and process the Excel data
// app.post("/api/organize-data", async (req, res) => {
//   try {
//     // Check if a file is uploaded
//     if (!req.files || !req.files.file) {
//       return res.status(400).json({ message: "No file uploaded" });
//     }

//     const file = req.files.file;

//     // Save the uploaded file temporarily
//     const tempFilePath = path.join(__dirname, "temp", file.name);
//     if (!fs.existsSync(path.dirname(tempFilePath))) {
//       fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
//     }
//     await file.mv(tempFilePath);

//     // Load the uploaded file
//     const workbook = xlsx.readFile(tempFilePath);
//     const sampleDataSheetName = "WorkDurationReport";

//     // Check if the required sheet exists
//     if (!workbook.Sheets[sampleDataSheetName]) {
//       return res.status(400).json({ message: `Sheet "${sampleDataSheetName}" not found in the file.` });
//     }

//     const sheet = workbook.Sheets[sampleDataSheetName];
//     const sheetData = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });

//     // Generate organized data
//     const organizedData = [
//       [
//         "Employee Code",
//         "Employee Name",
//         "Date",
//         "In Time",
//         "Out Time",
//         "Shift",
//         "Late By",
//         "OT Hours",
//         "Final OT Hours",
//         "Total Present Days",
//       ],
//     ];

//     // Helper function to calculate Late By, OT Hours, Final OT Hours, and Total Present Days
//     function calculateMetrics(inTime, outTime) {
//       const DEFAULT_SHIFT_START = "09:00"; // Shift start time
//       const DEFAULT_SHIFT_END = "18:00"; // Shift end time

//       // Convert times to Date objects
//       const inTimeDate = new Date(`1970-01-01T${inTime}:00`);
//       const outTimeDate = new Date(`1970-01-01T${outTime}:00`);
//       const shiftStartDate = new Date(`1970-01-01T${DEFAULT_SHIFT_START}:00`);
//       const shiftEndDate = new Date(`1970-01-01T${DEFAULT_SHIFT_END}:00`);

//       // Calculate Late By
//       let lateBy = 0;
//       if (inTimeDate > shiftStartDate) {
//         lateBy = (inTimeDate - shiftStartDate) / (1000 * 60); // Late by in minutes
//       }

//       // Calculate OT Hours
//       let otHours = 0;
//       if (outTimeDate > shiftEndDate) {
//         otHours = (outTimeDate - shiftEndDate) / (1000 * 60 * 60); // OT hours
//       }

//       // Final OT Hours (round to the nearest 0.5)
//       const finalOtHours = Math.round(otHours * 2) / 2;

//       // Total Present Days
//       const totalPresentDays = inTime !== "00:00" && outTime !== "00:00" ? 1 : 0;

//       return {
//         lateBy: lateBy > 0 ? `${Math.floor(lateBy / 60)}:${lateBy % 60}` : "00:00",
//         otHours,
//         finalOtHours,
//         totalPresentDays,
//       };
//     }

//     let currentEmployee = {};

//     // Process rows to extract employee data and attendance
//     sheetData.forEach((row, rowIndex) => {
//       // Search for "Employee:" in columns A and B
//       if (row[0]?.includes("Employee:") || row[1]?.includes("Employee:")) {
//         // Extract Employee Code and Name from columns C, D, E, F
//         const details = row.slice(2).find((cell) => cell.includes(":"));
//         if (details) {
//           const [code, name] = details.split(":").map((s) => s.trim());
//           currentEmployee = { code, name };
//         }
//       }

//       // Process attendance data starting from the "Days" row
//       if (rowIndex >= 7 && currentEmployee.code) {
//         const date = sheetData[6][rowIndex - 7]; // Map to the "Days" row
//         const status = row[0] || "N/A";
//         const inTime = row[1] || "00:00";
//         const outTime = row[2] || "00:00";
//         const duration = row[3] || "0";
//         const shift = "Shift 1"; // Default shift

//         // Calculate metrics
//         const { lateBy, otHours, finalOtHours, totalPresentDays } = calculateMetrics(inTime, outTime);

//         // Add processed data to the organized output
//         organizedData.push([
//           currentEmployee.code,
//           currentEmployee.name,
//           date,
//           status,
//           inTime,
//           outTime,
//           duration,
//           shift,
//           lateBy,
//           otHours,
//           finalOtHours,
//           totalPresentDays,
//         ]);
//       }
//     });

//     // Optional: Save organized data to a new Excel file
//     const outputWorkbook = xlsx.utils.book_new();
//     const organisedSheet = xlsx.utils.aoa_to_sheet(organizedData);
//     xlsx.utils.book_append_sheet(outputWorkbook, organisedSheet, "Organised Attendance Data");

//     const outputFilePath = path.join(__dirname, "Organised_Consolidated_Report.xlsx");
//     xlsx.writeFile(outputWorkbook, outputFilePath);

//     // Cleanup: Delete the temporary file
//     fs.unlinkSync(tempFilePath);

//     // Send the organized data as a response
//     return res.status(200).json({
//       message: "Data processed successfully",
//       data: organizedData.slice(1), // Exclude the header row from the JSON response
//       downloadLink: `http://localhost:${PORT}/download/Organised_Consolidated_Report.xlsx`,
//     });
//   } catch (error) {
//     console.error("Error processing file:", error);
//     return res.status(500).json({ message: "Internal server error", error: error.message });
//   }
// });

// // Route to download the organized Excel file
// app.get("/download/:filename", (req, res) => {
//   const { filename } = req.params;
//   const filePath = path.join(__dirname, filename);

//   if (fs.existsSync(filePath)) {
//     return res.download(filePath);
//   } else {
//     return res.status(404).json({ message: "File not found" });
//   }
// });

// // Start the server
// app.listen(PORT, () => {
//   console.log(`Server running on http://localhost:${PORT}`);
// });


