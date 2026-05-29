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
const GROUP_OPTIONS = ["year1", "year2", "year3"];
const GROUP_LABELS = {
  year1: "Year 1",
  year2: "Year 2",
  year3: "Year 3",
  unassigned: "Unassigned",
};

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
    group: {
      type: String,
      enum: [...GROUP_OPTIONS, null],
      default: null,
    },
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

function normalizeGroup(group) {
  const normalized = String(group || "")
    .trim()
    .toLowerCase();

  return GROUP_OPTIONS.includes(normalized) ? normalized : null;
}

function parseTaskNumber(taskId) {
  const parsed = Number.parseInt(String(taskId || ""), 10);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function compareTaskIds(leftTaskId, rightTaskId) {
  const difference = parseTaskNumber(leftTaskId) - parseTaskNumber(rightTaskId);
  if (difference !== 0) return difference;
  return String(leftTaskId || "").localeCompare(String(rightTaskId || ""), {
    numeric: true,
    sensitivity: "base",
  });
}

function csvEscape(value) {
  const raw = String(value ?? "");
  if (/[",\n]/.test(raw)) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

function sortTasks(tasks) {
  return [...tasks].sort((left, right) => compareTaskIds(left._id, right._id));
}

function buildAdminOverview(tasks, students, role) {
  const sortedTasks = sortTasks(tasks);
  const taskTitleById = Object.fromEntries(
    sortedTasks.map((task) => [task._id, task.title]),
  );

  const enrichedStudents = students
    .map((student) => {
      const responses = [...(student.responses || [])]
        .map((response) => ({
          taskId: response.taskId,
          title: taskTitleById[response.taskId] || "Untitled task",
          rating:
            typeof response.rating === "number" && response.rating >= 0
              ? response.rating
              : null,
          evidenceLinks: response.evidenceLinks || [],
          updatedAt: response.updatedAt || null,
        }))
        .sort((left, right) => compareTaskIds(left.taskId, right.taskId));

      const ratedResponses = responses.filter(
        (response) => typeof response.rating === "number",
      );

      return {
        email: student.email,
        displayName: student.displayName || "",
        group: normalizeGroup(student.group),
        groupLabel: GROUP_LABELS[normalizeGroup(student.group) || "unassigned"],
        updatedAt: student.updatedAt || null,
        completionCount: ratedResponses.length,
        masteryCount: ratedResponses.filter((response) => response.rating === 3)
          .length,
        lowConfidenceCount: ratedResponses.filter(
          (response) => response.rating <= 1,
        ).length,
        responses,
      };
    })
    .sort((left, right) => {
      const leftName = String(left.displayName || left.email).toLowerCase();
      const rightName = String(right.displayName || right.email).toLowerCase();
      return leftName.localeCompare(rightName);
    });

  const taskCoverage = sortedTasks.map((task) => {
    let notCovered = 0;
    let introduced = 0;
    let developing = 0;
    let mastery = 0;
    let unrated = 0;
    let evidenceCount = 0;
    const studentsNeedingAttention = [];

    const studentRatings = enrichedStudents.map((student) => {
      const response =
        student.responses.find((entry) => entry.taskId === task._id) || null;

      if (!response || response.rating === null) {
        unrated += 1;
        studentsNeedingAttention.push(student.displayName || student.email);
      } else {
        if (response.rating === 0) notCovered += 1;
        if (response.rating === 1) introduced += 1;
        if (response.rating === 2) developing += 1;
        if (response.rating === 3) mastery += 1;
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
        group: student.group,
        groupLabel: student.groupLabel,
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

  const submittedRatings = enrichedStudents.reduce(
    (count, student) => count + student.completionCount,
    0,
  );
  const evidenceLinks = enrichedStudents.reduce(
    (count, student) =>
      count +
      student.responses.reduce(
        (responseCount, response) => responseCount + response.evidenceLinks.length,
        0,
      ),
    0,
  );

  const groupReports = [...GROUP_OPTIONS, null].map((groupKey) => {
    const groupStudents = enrichedStudents.filter(
      (student) => normalizeGroup(student.group) === groupKey,
    );
    const ratings = groupStudents.flatMap((student) =>
      student.responses
        .filter((response) => typeof response.rating === "number")
        .map((response) => response.rating),
    );

    const taskAverages = sortedTasks.map((task) => {
      const ratingsForTask = groupStudents
        .map((student) =>
          student.responses.find((response) => response.taskId === task._id),
        )
        .filter((response) => typeof response?.rating === "number")
        .map((response) => response.rating);

      return {
        taskId: task._id,
        title: task.title,
        responseCount: ratingsForTask.length,
        averageScore: ratingsForTask.length
          ? Number(
              (
                ratingsForTask.reduce((sum, rating) => sum + rating, 0) /
                ratingsForTask.length
              ).toFixed(2),
            )
          : null,
      };
    });

    return {
      key: groupKey || "unassigned",
      label: GROUP_LABELS[groupKey || "unassigned"],
      studentCount: groupStudents.length,
      submittedRatings: ratings.length,
      averageScore: ratings.length
        ? Number(
            (
              ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
            ).toFixed(2),
          )
        : null,
      taskAverages,
    };
  });

  return {
    role,
    summary: {
      studentCount: enrichedStudents.length,
      taskCount: sortedTasks.length,
      submittedRatings,
      evidenceLinks,
    },
    tasks: sortedTasks,
    students: enrichedStudents,
    taskCoverage,
    groupReports,
    groups: GROUP_OPTIONS.map((groupKey) => ({
      key: groupKey,
      label: GROUP_LABELS[groupKey],
    })),
  };
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
  res.json(sortTasks(tasks));
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

  if (!email) {
    return res.status(400).json({ message: "Email is required." });
  }

  if (![0, 1, 2, 3].includes(rating)) {
    return res.status(400).json({ message: "Rating must be between 0 and 3." });
  }

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
  res.json(buildAdminOverview(tasks, students, req.userRole));
});

app.get("/admin/report.csv", requireAdmin, async (req, res) => {
  const requestedGroup = normalizeGroup(req.query.group);
  const tasks = await Task.find().lean();
  const students = await StudentProgress.find().lean();
  const overview = buildAdminOverview(tasks, students, req.userRole);
  const filteredStudents = requestedGroup
    ? overview.students.filter((student) => student.group === requestedGroup)
    : overview.students;

  const rows = [
    [
      "Student",
      "Email",
      "Group",
      "Task ID",
      "Task Title",
      "Rating",
      "Rating Label",
      "Evidence Links",
      "Updated At",
    ],
  ];

  filteredStudents.forEach((student) => {
    const submittedResponses = student.responses.filter(
      (response) =>
        typeof response.rating === "number" || response.evidenceLinks.length > 0,
    );

    if (submittedResponses.length === 0) {
      rows.push([
        student.displayName || student.email,
        student.email,
        student.groupLabel,
        "",
        "",
        "",
        "",
        "",
        "",
      ]);
      return;
    }

    submittedResponses.forEach((response) => {
      rows.push([
        student.displayName || student.email,
        student.email,
        student.groupLabel,
        response.taskId,
        response.title,
        response.rating ?? "",
        typeof response.rating === "number"
          ? ["Unsure", "Introduced", "Developing", "Mastery"][response.rating]
          : "",
        response.evidenceLinks.join(" | "),
        response.updatedAt ? new Date(response.updatedAt).toISOString() : "",
      ]);
    });
  });

  const csv = rows
    .map((row) => row.map((value) => csvEscape(value)).join(","))
    .join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${requestedGroup || "all-groups"}-task-report.csv"`,
  );
  res.send(csv);
});

app.put("/admin/students/:email/group", requireAdmin, async (req, res) => {
  const email = normalizeEmail(req.params.email);
  const group = normalizeGroup(req.body.group);

  const student = await StudentProgress.findOne({ email });
  if (!student) {
    return res.status(404).json({ message: "Student not found." });
  }

  student.group = group;
  await student.save();

  res.json({
    success: true,
    student: {
      email: student.email,
      group: student.group,
      groupLabel: GROUP_LABELS[student.group || "unassigned"],
    },
  });
});

app.post("/admin/tasks", requireAdmin, async (req, res) => {
  const taskId = String(req.body.taskId || "").trim();
  const title = String(req.body.title || "").trim();
  const course = String(req.body.course || "").trim();
  const video = String(req.body.video || "").trim();

  if (!taskId || !title) {
    return res.status(400).json({ message: "Task number and title are required." });
  }

  const existing = await Task.findById(taskId);
  if (existing) {
    return res.status(400).json({ message: "Task number already exists." });
  }

  await Task.create({
    _id: taskId,
    title,
    resources: {
      course: course || null,
      video: video || null,
    },
  });

  const tasks = await Task.find().lean();
  res.json({ success: true, tasks: sortTasks(tasks) });
});

app.put("/admin/tasks/:taskId", requireAdmin, async (req, res) => {
  const taskId = String(req.params.taskId || "").trim();
  const title = String(req.body.title || "").trim();
  const course = String(req.body.course || "").trim();
  const video = String(req.body.video || "").trim();

  if (!title) {
    return res.status(400).json({ message: "Task title is required." });
  }

  const task = await Task.findById(taskId);
  if (!task) {
    return res.status(404).json({ message: "Task not found." });
  }

  task.title = title;
  task.resources = {
    course: course || null,
    video: video || null,
  };
  await task.save();

  const tasks = await Task.find().lean();
  res.json({ success: true, tasks: sortTasks(tasks) });
});

app.delete("/admin/tasks/:taskId", requireAdmin, async (req, res) => {
  const taskId = String(req.params.taskId || "").trim();
  await Task.deleteOne({ _id: taskId });

  await StudentProgress.updateMany(
    {},
    { $pull: { responses: { taskId } } },
  );

  const tasks = await Task.find().lean();
  res.json({ success: true, tasks: sortTasks(tasks) });
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
