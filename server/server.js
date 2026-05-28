import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadEnvFile } from "./env.js";

loadEnvFile();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/task_app";
const clientDistPath = path.resolve(__dirname, "../tasklist/dist");
const clientIndexPath = path.join(clientDistPath, "index.html");

const app = express();

app.use(
  cors({
    origin: CLIENT_ORIGIN.split(",").map((origin) => origin.trim()),
  }),
);
app.use(express.json());

/* =========================
   MODELS
========================= */

// TASKS
const taskSchema = new mongoose.Schema(
  {
    _id: String,
    title: { type: String, required: true, trim: true },
    resources: {
      course: { type: String, default: null },
      video: { type: String, default: null },
    },
  },
  { versionKey: false },
);

// STUDENT PROGRESS
const studentResponseSchema = new mongoose.Schema(
  {
    taskId: String,
    rating: Number,
    evidenceLinks: [String],
    updatedAt: Date,
  },
  { _id: false },
);

const studentProgressSchema = new mongoose.Schema(
  {
    email: { type: String, unique: true },
    displayName: String,
    responses: [studentResponseSchema],
  },
  { timestamps: true },
);

// ✅ ADMIN MODEL (NEW)
const adminSchema = new mongoose.Schema(
  {
    email: { type: String, unique: true, required: true },
    displayName: { type: String, default: "" },
    role: {
      type: String,
      enum: ["admin", "superAdmin"],
      default: "admin",
    },
    addedAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

const Task = mongoose.model("Task", taskSchema);
const StudentProgress = mongoose.model(
  "StudentProgress",
  studentProgressSchema,
);
const Admin = mongoose.model("Admin", adminSchema);
const mongoConnectionStates = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

/* =========================
   HELPERS
========================= */

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

async function getUserRole(email) {
  if (!email) return false;
  const admin = await Admin.findOne({ email });
  return admin ? admin.role : false;
}

async function requireAdmin(req, res, next) {
  const email = normalizeEmail(req.query.email || req.headers["x-user-email"]);

  const role = await getUserRole(email);

  if (!role) {
    return res.status(403).json({ message: "Admin required." });
  }

  req.userEmail = email;
  req.userRole = role;
  next();
}

async function requireSuperAdmin(req, res, next) {
  const email = normalizeEmail(req.body.requesterEmail);

  const role = await getUserRole(email);

  if (role !== "superAdmin") {
    return res.status(403).json({ message: "Super admin required." });
  }

  req.userEmail = email;
  next();
}

/* =========================
   BASIC ROUTES
========================= */

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    database: mongoConnectionStates[mongoose.connection.readyState] || "unknown",
  });
});

app.get("/tasks", async (_req, res) => {
  const tasks = await Task.find().lean();
  tasks.sort((a, b) => Number(a._id) - Number(b._id));
  res.json(tasks);
});

app.get("/responses/:email", async (req, res) => {
  const email = normalizeEmail(req.params.email);
  const student = await StudentProgress.findOne({ email }).lean();

  res.json(
    student || {
      email,
      displayName: "",
      responses: [],
    },
  );
});

/* =========================
   SAVE RESPONSE
========================= */

app.put("/responses/:taskId", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const taskId = req.params.taskId;
  const rating = Number(req.body.rating);
  const evidenceLinks = req.body.evidenceLinks || [];

  let student = await StudentProgress.findOne({ email });

  if (!student) {
    student = new StudentProgress({
      email,
      displayName: req.body.displayName,
      responses: [],
    });
  }

  const existing = student.responses.find((r) => r.taskId === taskId);

  if (existing) {
    existing.rating = rating;
    existing.evidenceLinks = evidenceLinks;
    existing.updatedAt = new Date();
  } else {
    student.responses.push({
      taskId,
      rating,
      evidenceLinks,
      updatedAt: new Date(),
    });
  }

  await student.save();

  res.json({ success: true, student });
});

/* =========================
   ADMIN OVERVIEW
========================= */

app.get("/admin/overview", requireAdmin, async (req, res) => {
  const tasks = await Task.find().lean();
  const students = await StudentProgress.find().lean();

  const taskCoverage = tasks.map((task) => {
    let notCovered = 0;
    let introduced = 0;
    let developing = 0;
    let mastery = 0;
    let unrated = 0;
    let evidenceCount = 0;
    const studentsNeedingAttention = [];

    const studentRatings = students.map((student) => {
      const response = student.responses.find((r) => r.taskId === task._id);

      if (!response || response.rating === null) {
        unrated++;
        studentsNeedingAttention.push(student.displayName || student.email);
      } else {
        if (response.rating === 0) notCovered++;
        if (response.rating === 1) introduced++;
        if (response.rating === 2) developing++;
        if (response.rating === 3) mastery++;

        if (response.rating <= 1) {
          studentsNeedingAttention.push(student.displayName || student.email);
        }
      }

      if (response?.evidenceLinks?.length) {
        evidenceCount += response.evidenceLinks.length;
      }

      return {
        email: student.email,
        displayName: student.displayName,
        rating: response?.rating ?? null,
        evidenceLinks: response?.evidenceLinks || [],
        updatedAt: response?.updatedAt || null,
      };
    });

    return {
      taskId: task._id,
      title: task.title,
      notCovered,
      introduced,
      developing,
      mastery,
      unrated,
      evidenceCount,
      studentsNeedingAttention,
      studentRatings,
    };
  });

  res.json({
    role: req.userRole,
    summary: {
      studentCount: students.length,
      taskCount: tasks.length,
    },
    students,
    taskCoverage,
  });
});
/* =========================
   ✅ ADMIN MANAGEMENT
========================= */

// GET admins
app.get("/admin/admins", requireAdmin, async (_req, res) => {
  const admins = await Admin.find().lean();
  res.json({ admins });
});

// ADD admin (SUPER ADMIN ONLY)
app.post("/admin/admins", requireSuperAdmin, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const role = req.body.role === "superAdmin" ? "superAdmin" : "admin";

  if (!email) {
    return res.status(400).json({ message: "Email required." });
  }

  const exists = await Admin.findOne({ email });
  if (exists) {
    return res.status(400).json({ message: "Already exists." });
  }

  await Admin.create({ email, role });

  const admins = await Admin.find().lean();
  res.json({ admins });
});

// REMOVE admin (SUPER ADMIN ONLY)
app.delete("/admin/admins/:email", requireSuperAdmin, async (req, res) => {
  const email = normalizeEmail(req.params.email);

  await Admin.deleteOne({ email });

  const admins = await Admin.find().lean();
  res.json({ admins });
});

/* =========================
   CLIENT APP
========================= */

if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));

  app.get(/.*/, (_req, res) => {
    res.sendFile(clientIndexPath);
  });
}

/* =========================
   START SERVER
========================= */

async function connectDatabase() {
  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });
  console.log("Mongo connected");

  // ✅ Create FIRST super admin automatically
  const FIRST_ADMIN = normalizeEmail(process.env.FIRST_ADMIN || "");

  if (FIRST_ADMIN) {
    const exists = await Admin.findOne({ email: FIRST_ADMIN });
    if (!exists) {
      await Admin.create({
        email: FIRST_ADMIN,
        role: "superAdmin",
      });
      console.log("Created first super admin:", FIRST_ADMIN);
    }
  }

}

function start() {
  app.listen(PORT, () =>
    console.log(`Server running on http://localhost:${PORT}`),
  );

  connectDatabase().catch((error) => {
    console.error("Mongo connection failed:", error.message);
  });
}

start();
