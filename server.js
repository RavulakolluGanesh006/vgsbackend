import express from "express";
import cors from "cors";
import morgan from "morgan";
import multer from "multer";
import path from "path";
import fs from "fs";
import "dotenv/config";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// --- Setup ---
const app = express();
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

// --- MongoDB connection ---
const MONGO_URI = process.env.MONGO_URI ;
await mongoose.connect(MONGO_URI)
// --- Schemas & Models ---
const imageSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  url: { type: String, required: true },
  filename: { type: String, required: true }
}, { 
  timestamps: true,
  collection: "pics"   // 👈 collection = pics
});

const Image = mongoose.model("Image", imageSchema);

// --- Review Schema & Model ---
const reviewSchema = new mongoose.Schema({
  name: { type: String, required: true },
  rating: { type: Number, required: true },
  text: { type: String, required: true }
}, {
  timestamps: true,
  collection: "reviews"
});
const Review = mongoose.model("Review", reviewSchema);

// --- Job Schema & Model ---
const JobSchema = new mongoose.Schema({
  role: { type: String, required: true },
  type: { type: String, enum: ["Full-time", "Part-time"], default: "Full-time" },
  location:{ type: String, required: true },
  experience: { type: String, required: true },
  skills: { type: String, required: true },
  category: { type: String, enum: ["Software Development", "Staffing"], required: true },
  description: { type: String, required: true },
}, { timestamps: true });

const Job = mongoose.model("Job", JobSchema);


const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true } // hashed
});
const User = mongoose.model("User", userSchema);

//optional if required
// const candidateSchema = new mongoose.Schema({
//   jobRole: String,
//   companyName: String,
//   jobId: String,
//   jobLocation: String,
//   candidateId: String,
//   fullName: String,
//   email: String,
//   mobile: String,
//   domain: String,
//   degree: String,
//   branch: String,
//   yearOfPassedOut: String,
//   gender: String,
//   dob: String,
//   experience: String,
//   megaDrive: String,
//   resume: String
// }, { timestamps: true });

// const Candidate = mongoose.model("Candidate", candidateSchema);

// --- Middleware for Authentication ---
function authMiddleware(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ error: "No token provided" });

  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Invalid token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // attach user info
    next();
  } catch (err) {
    return res.status(403).json({ error: "Token invalid or expired" });
  }
}


// --- Multer setup for uploads ---
const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const key = req.body.key || "image";
    cb(null, `${Date.now()}_${key}_${safe}`);
  }
});
const upload = multer({ storage });

// Serve uploaded files statically
app.use("/uploads", express.static(UPLOAD_DIR));

const BASE_URL = process.env.BASE_URL || "http://localhost:" + (process.env.PORT || 4000);

// --- Routes ---
// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, at: new Date().toISOString() });
});

// Get all images
app.get("/api/images", async (req, res) => {
  const docs = await Image.find().lean();
  const map = {};
  for (const d of docs) map[d.key] = d.url;
  res.json(map);
});

// Get single image by key
app.get("/api/images/:key", async (req, res) => {
  const doc = await Image.findOne({ key: req.params.key }).lean();
  if (!doc) return res.status(404).json({ error: "Not found" });
  res.json({ key: doc.key, url: doc.url });
});

// Upload / Replace an image
app.post("/api/upload", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    const key = req.body.key;
    if (!key) return res.status(400).json({ error: "Missing 'key' field" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const fileUrl = `${BASE_URL}/uploads/${encodeURIComponent(req.file.filename)}`;

    const existing = await Image.findOne({ key });
    if (existing && existing.filename && existing.filename !== req.file.filename) {
      const oldPath = path.join(UPLOAD_DIR, existing.filename);
      if (fs.existsSync(oldPath)) fs.unlink(oldPath, () => {});
    }

    const doc = await Image.findOneAndUpdate(
      { key },
      { key, url: fileUrl, filename: req.file.filename },
      { upsert: true, new: true }
    );

    res.json({ success: true, key: doc.key, url: doc.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// Delete image
app.delete("/api/images/:key", async (req, res) => {
  const key = req.params.key;
  const doc = await Image.findOneAndDelete({ key });
  if (doc?.filename) {
    const oldPath = path.join(UPLOAD_DIR, doc.filename);
    if (fs.existsSync(oldPath)) fs.unlink(oldPath, () => {});
  }
  res.json({ success: true, key });
});

// --- Reviews API ---

// Get all reviews (latest first)
app.get("/api/reviews", async (req, res) => {
  try {
    const reviews = await Review.find().sort({ createdAt: -1 }).lean();
    res.json(reviews);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

// Submit a new review
app.post("/api/reviews", async (req, res) => {
  try {
    const { name, rating, text } = req.body;
    if (!name || !rating || !text) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const review = await Review.create({ name, rating, text });
    res.json({ success: true, review });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save review" });
  }
});



// Career Jobs API


// Add Job
app.post("/api/jobs", authMiddleware,  async (req, res) => {
  try {
    const { role, type, location, experience, skills, category, description } = req.body; // 👈 added description
    const job = new Job({ role, type, location, experience, skills, category, description }); // 👈 save description
    await job.save();
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all Jobs
app.get("/api/jobs", async (req, res) => {
  try {
    const filter = {};
    if (req.query.category) {
      filter.category = req.query.category; // ?category=Software%20Development
    }
    const jobs = await Job.find(filter);
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete Job
app.delete("/api/jobs/:id", authMiddleware, async (req, res) => {
  try {
    await Job.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});




// Apply Job → Save only to Excel
// Apply Job → Save only to Excel
const EXCEL_PATH = path.join(process.cwd(), "candidates.xlsx");

// Apply Job → Save only to Excel
app.post("/api/apply", upload.single("resume"), async (req, res) => {
  try {
    const { 
      fullName,
      contactNo,
      email,
      degree,
      dob,
      address,
      gender,
      passoutYear,
      experience,
      currentCTC,
      organisationName,
      location,
      role,
      expectedCTC
    } = req.body;

    const resumeFile = req.file ? `${BASE_URL}/uploads/${req.file.filename}` : "";

    const workbook = new ExcelJS.Workbook();
    if (fs.existsSync(EXCEL_PATH)) {
      await workbook.xlsx.readFile(EXCEL_PATH);
    }
    const sheet = workbook.getWorksheet("Candidates") || workbook.addWorksheet("Candidates");

    // Add header row if sheet is empty
    if (sheet.rowCount === 0) {
      sheet.addRow([
        "Full Name",
        "Contact No",
        "Email",
        "Degree",
        "Date of Birth",
        "Address",
        "Gender",
        "Passout Year",
        "Experience",
        "Current CTC",
        "Organisation Name",
        "Location",
        "Role",
        "Expected CTC",
        "Resume"
      ]);
    }

    // Add data row
    const row = sheet.addRow([
      fullName,
      contactNo,
      email,
      degree,
      dob,
      address,
      gender,
      passoutYear,
      experience,
      currentCTC,
      organisationName,
      location,
      role,
      expectedCTC,
      ""
    ]);

    // Resume hyperlink
    if (resumeFile) {
      row.getCell(15).value = {
        text: "📄 View Resume",
        hyperlink: resumeFile
      };
      row.getCell(15).font = { color: { argb: "FF0000FF" }, underline: true }; // Blue link
    }

    await workbook.xlsx.writeFile(EXCEL_PATH);

    res.json({ success: true, message: "Application saved!", resume: resumeFile });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});




app.get("/api/applications/count", async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    if (!fs.existsSync(EXCEL_PATH)) {
      return res.json({ count: 0 });
    }
    await workbook.xlsx.readFile(EXCEL_PATH);
    const sheet = workbook.getWorksheet("Candidates");
    if (!sheet) return res.json({ count: 0 });

    // Subtract header row
    const count = sheet.rowCount > 1 ? sheet.rowCount - 1 : 0;
    res.json({ count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ count: 0, error: err.message });
  }
});




// Download Excel file
app.get("/api/applications/download", authMiddleware, (req, res) => {
  if (!fs.existsSync(EXCEL_PATH)) {
    return res.status(404).send("No applications found");
  }
  res.download(EXCEL_PATH, "candidates.xlsx");
});


// Register admin (one-time)
// Register admin (one-time only)

app.post("/api/register", async (req, res) => {
  try {
    const existingAdmin = await User.findOne();
    if (existingAdmin) {
      return res.status(403).json({
        success: false,
        error: "Admin already exists. Registration is disabled."
      });
    }

    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: "Username and password required" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashed });
    await user.save();

    res.json({ success: true, message: "Admin created successfully" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Login API
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  const ADMIN_USER = process.env.ADMIN_USER;
  const ADMIN_PASS = process.env.ADMIN_PASS;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign(
      { username: ADMIN_USER, role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );
    return res.json({ success: true, token });
  }

  return res.status(401).json({ success: false, error: "Invalid credentials" });
});














// --- Start server ---
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

