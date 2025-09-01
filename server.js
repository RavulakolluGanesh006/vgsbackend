
import express from "express";
import cors from "cors";
import morgan from "morgan";
import multer from "multer";
import path from "path";
import fs from "fs";
import "dotenv/config";
import mongoose from "mongoose";

// --- Setup ---
const app = express();
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

// --- MongoDB connection ---
const MONGO_URI = process.env.MONGO_URI  // local DB = vgs
await mongoose.connect(MONGO_URI);

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
}, { timestamps: true });

const Job = mongoose.model("Job", JobSchema);



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
app.post("/api/upload", upload.single("image"), async (req, res) => {
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


// Create Job
app.post("/api/jobs", async (req, res) => {
  try {
    const { role, type, location, experience, skills } = req.body;
    const job = new Job({ role, type, location, experience, skills });
    await job.save();
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all jobs
app.get("/api/jobs", async (req, res) => {
  try {
    const jobs = await Job.find();
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete job
app.delete("/api/jobs/:id", async (req, res) => {
  try {
    await Job.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});








// --- Start server ---
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
