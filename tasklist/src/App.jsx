import { useEffect, useMemo, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { loginRequest } from "./authConfig";
import "./App.css";

const API =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? "" : "http://localhost:3001");
const ADMIN_REFRESH_MS = 5000;
const THEME_STORAGE_KEY = "tasklist-theme";
const ratingLabels = ["Unsure", "Introduced", "Developing", "Mastery"];
const groupLabels = {
  year1: "Year 1",
  year2: "Year 2",
  year3: "Year 3",
  unassigned: "Unassigned",
};
function toResponseMap(responseList = []) {
  return responseList.reduce((accumulator, response) => {
    accumulator[response.taskId] = response;
    return accumulator;
  }, {});
}

function linksToTextareaValue(links = []) {
  return links.join("\n");
}

function textareaValueToLinks(value) {
  return [
    ...new Set(
      value
        .split("\n")
        .map((link) => link.trim())
        .filter(Boolean),
    ),
  ];
}

function formatDate(value) {
  if (!value) return "No recent update";
  return new Date(value).toLocaleString();
}

function metricTone(value, maxValue) {
  if (value === null || value === undefined) return "neutral";
  if (value <= 1) return "warning";
  if (value >= maxValue) return "success";
  return "neutral";
}

function matchesSearch(text, query) {
  return String(text || "")
    .toLowerCase()
    .includes(query.toLowerCase());
}

function taskNumberValue(taskId) {
  const numericTaskId = Number.parseInt(String(taskId || ""), 10);
  return Number.isNaN(numericTaskId) ? Number.MAX_SAFE_INTEGER : numericTaskId;
}

function sortTasksByNumber(items = [], taskIdSelector) {
  return [...items].sort((left, right) => {
    const leftTaskId = taskIdSelector(left);
    const rightTaskId = taskIdSelector(right);
    const taskNumberDifference =
      taskNumberValue(leftTaskId) - taskNumberValue(rightTaskId);

    if (taskNumberDifference !== 0) {
      return taskNumberDifference;
    }

    return String(leftTaskId || "").localeCompare(String(rightTaskId || ""), {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function buildTaskStudentRatings(taskId, students = []) {
  return students
    .map((student) => {
      const response =
        student.responses.find((entry) => entry.taskId === taskId) || null;
      return {
        email: student.email,
        displayName: student.displayName,
        rating: response?.rating ?? null,
        evidenceLinks: response?.evidenceLinks || [],
        updatedAt: response?.updatedAt || student.updatedAt || null,
      };
    })
    .sort((left, right) => {
      const leftName = String(left.displayName || left.email).toLowerCase();
      const rightName = String(right.displayName || right.email).toLowerCase();
      return leftName.localeCompare(rightName);
    });
}

function downloadBlob(blob, filename) {
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
}

// ─────────────────────────────────────────────
// SUPER ADMIN PANEL
// ─────────────────────────────────────────────

function SuperAdminPanel({ currentUserEmail }) {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("admin");
  const [addState, setAddState] = useState("idle"); // idle | saving | saved | error
  const [removeState, setRemoveState] = useState({}); // email → idle | removing | error
  const [panelError, setPanelError] = useState("");

  async function loadAdmins() {
    setLoading(true);
    setPanelError("");
    try {
      const res = await fetch(
        `${API}/admin/admins?email=${encodeURIComponent(currentUserEmail)}`,
      );
      if (!res.ok) throw new Error("Could not load admin list.");
      const data = await res.json();
      setAdmins(data.admins || []);
    } catch (err) {
      setPanelError(err.message || "Could not load admin list.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      loadAdmins();
    }, 0);

    return () => window.clearTimeout(timerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAdd() {
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed) return;
    if (admins.some((a) => a.email === trimmed)) {
      setPanelError("That email already has a role assigned.");
      return;
    }
    setAddState("saving");
    setPanelError("");
    try {
      const res = await fetch(`${API}/admin/admins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requesterEmail: currentUserEmail,
          email: trimmed,
          role: newRole,
        }),
      });
      if (!res.ok) throw new Error("Could not add admin.");
      const data = await res.json();
      setAdmins(data.admins || []);
      setNewEmail("");
      setNewRole("admin");
      setAddState("saved");
      setTimeout(() => setAddState("idle"), 2000);
    } catch (err) {
      setPanelError(err.message || "Could not add admin.");
      setAddState("error");
      setTimeout(() => setAddState("idle"), 3000);
    }
  }

  async function handleRemove(email) {
    if (email === currentUserEmail) {
      setPanelError("You cannot remove your own super admin role.");
      return;
    }
    setRemoveState((s) => ({ ...s, [email]: "removing" }));
    setPanelError("");
    try {
      const res = await fetch(
        `${API}/admin/admins/${encodeURIComponent(email)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requesterEmail: currentUserEmail }),
        },
      );
      if (!res.ok) throw new Error("Could not remove admin.");
      const data = await res.json();
      setAdmins(data.admins || []);
      setRemoveState((s) => ({ ...s, [email]: "idle" }));
    } catch (err) {
      setPanelError(err.message || "Could not remove admin.");
      setRemoveState((s) => ({ ...s, [email]: "error" }));
      setTimeout(
        () => setRemoveState((s) => ({ ...s, [email]: "idle" })),
        3000,
      );
    }
  }

  const addButtonLabel =
    addState === "saving"
      ? "Adding…"
      : addState === "saved"
        ? "Added ✓"
        : addState === "error"
          ? "Failed — retry"
          : "Add";

  return (
    <div className="admin-layout">
      {panelError ? <p className="status-banner error">{panelError}</p> : null}

      {/* Add new admin */}
      <section className="admin-section">
        <div className="section-heading">
          <h2>Grant access</h2>
          <p className="muted-copy">
            Add a Microsoft account email and assign it a role. Super admins can
            manage other admins; admins can only view the dashboard.
          </p>
        </div>

        <article className="admin-card">
          <div className="superadmin-add-row">
            <label className="superadmin-field">
              <span className="superadmin-label">Email address</span>
              <input
                type="email"
                className="superadmin-input"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="user@example.com"
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
            </label>

            <label className="superadmin-field superadmin-field--role">
              <span className="superadmin-label">Role</span>
              <select
                className="superadmin-select"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
              >
                <option value="admin">Admin</option>
                <option value="superAdmin">Super Admin</option>
              </select>
            </label>

            <button
              type="button"
              className="primary-button superadmin-add-btn"
              onClick={handleAdd}
              disabled={addState === "saving" || !newEmail.trim()}
            >
              {addButtonLabel}
            </button>
          </div>
        </article>
      </section>

      {/* Current admins list */}
      <section className="admin-section">
        <div className="section-heading">
          <h2>Current admins</h2>
          <p className="muted-copy">
            {admins.length} account{admins.length !== 1 ? "s" : ""} with
            elevated access.
          </p>
        </div>

        {loading ? (
          <section className="empty-state">
            <h2>Loading admin list…</h2>
          </section>
        ) : admins.length === 0 ? (
          <section className="empty-state">
            <h2>No admins configured yet.</h2>
            <p>Use the form above to grant the first admin access.</p>
          </section>
        ) : (
          <article className="admin-card">
            <div className="superadmin-list">
              {admins.map((admin) => {
                const isSelf = admin.email === currentUserEmail;
                const removing = removeState[admin.email] === "removing";
                const removeErr = removeState[admin.email] === "error";

                return (
                  <div key={admin.email} className="superadmin-row">
                    <div className="superadmin-info">
                      <strong className="superadmin-name">
                        {admin.displayName || admin.email}
                      </strong>
                      <span className="superadmin-email muted-copy">
                        {admin.email}
                      </span>
                      {admin.addedAt ? (
                        <span className="superadmin-since muted-copy">
                          Added {formatDate(admin.addedAt)}
                        </span>
                      ) : null}
                    </div>

                    <div className="superadmin-row-right">
                      <span
                        className={`superadmin-role-badge ${
                          admin.role === "superAdmin"
                            ? "superadmin-role-badge--super"
                            : "superadmin-role-badge--admin"
                        }`}
                      >
                        {admin.role === "superAdmin" ? "Super Admin" : "Admin"}
                      </span>

                      {isSelf ? (
                        <span className="superadmin-self-tag muted-copy">
                          (you)
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={`superadmin-remove-btn ${
                            removeErr ? "superadmin-remove-btn--error" : ""
                          }`}
                          onClick={() => handleRemove(admin.email)}
                          disabled={removing}
                        >
                          {removing
                            ? "Removing…"
                            : removeErr
                              ? "Failed"
                              : "Remove"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        )}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────
// STUDENT COMPONENTS (unchanged)
// ─────────────────────────────────────────────

function StudentTaskCard({
  task,
  currentResponse,
  evidenceValue,
  taskSaveState,
  onChangeEvidence,
  onSaveResponse,
}) {
  const currentRating = currentResponse?.rating ?? null;

  return (
    <article className="task-card">
      <div className="task-card-header">
        <span className="task-id">Task {task._id}</span>
        <span className={`task-state ${taskSaveState}`}>
          {taskSaveState === "saving" && "Saving..."}
          {taskSaveState === "saved" && "Saved"}
          {taskSaveState === "error" && "Retry needed"}
          {taskSaveState === "idle" && "Ready"}
        </span>
      </div>

      <h2>{task.title}</h2>

      <div className="rating-group" aria-label={`Rating for task ${task._id}`}>
        {[0, 1, 2, 3].map((ratingValue) => (
          <button
            key={ratingValue}
            type="button"
            className={
              currentRating === ratingValue
                ? "rating-button active"
                : "rating-button"
            }
            onClick={() => onSaveResponse(task._id, ratingValue, evidenceValue)}
          >
            <span>{ratingValue}</span>
            <small>{ratingLabels[ratingValue]}</small>
          </button>
        ))}
      </div>

      <label className="evidence-block">
        <span>Evidence links</span>
        <textarea
          rows="4"
          value={evidenceValue}
          placeholder="One URL per line, for example GitHub repos or demo videos."
          onChange={(event) => onChangeEvidence(task._id, event.target.value)}
        />
      </label>

      <div className="task-footer">
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            onSaveResponse(task._id, currentRating ?? 0, evidenceValue)
          }
        >
          Save evidence
        </button>

        <div className="resource-links">
          {task.resources?.course ? (
            <a href={task.resources.course} target="_blank" rel="noreferrer">
              Course
            </a>
          ) : null}
          {task.resources?.video ? (
            <a href={task.resources.video} target="_blank" rel="noreferrer">
              Video
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────
// ADMIN COMPONENTS (unchanged)
// ─────────────────────────────────────────────

function AdminCoverageCard({ task }) {
  const studentTotal =
    task.notCovered +
    task.introduced +
    task.developing +
    task.mastery +
    task.unrated;

  return (
    <article className="admin-card coverage-card">
      <div className="task-card-header">
        <span className="task-id">Task {task.taskId}</span>
        <span className="task-state live">
          {task.evidenceCount} evidence links
        </span>
      </div>

      <h3>{task.title}</h3>

      <div className="coverage-grid compact">
        <span
          className={`coverage-pill ${metricTone(task.notCovered, studentTotal)}`}
        >
          <strong>{task.notCovered}</strong>
          <small>Not covered</small>
        </span>
        <span className="coverage-pill neutral">
          <strong>{task.introduced}</strong>
          <small>Introduced</small>
        </span>
        <span className="coverage-pill neutral">
          <strong>{task.developing}</strong>
          <small>Developing</small>
        </span>
        <span
          className={`coverage-pill ${metricTone(task.mastery, studentTotal)}`}
        >
          <strong>{task.mastery}</strong>
          <small>Mastery</small>
        </span>
        <span
          className={`coverage-pill ${metricTone(task.unrated, studentTotal)}`}
        >
          <strong>{task.unrated}</strong>
          <small>Unrated</small>
        </span>
      </div>

      <p className="attention-list">
        Needs coverage:{" "}
        {task.studentsNeedingAttention.length > 0
          ? task.studentsNeedingAttention.join(", ")
          : "No one right now"}
      </p>

      <div className="response-list">
        {task.studentRatings?.length > 0 ? (
          task.studentRatings.map((entry) => (
            <div key={`${task.taskId}-${entry.email}`} className="response-row">
              <div className="response-copy compact">
                <strong>{entry.displayName || entry.email}</strong>
                <p className="muted-copy">
                  Rating:{" "}
                  {entry.rating === null
                    ? "Not submitted"
                    : `${entry.rating} - ${ratingLabels[entry.rating]}`}
                </p>
                <p className="response-updated">
                  Updated: {formatDate(entry.updatedAt)}
                </p>
              </div>

              {entry.evidenceLinks?.length > 0 ? (
                <div className="evidence-cluster">
                  {entry.evidenceLinks.map((link, index) => (
                    <a key={link} href={link} target="_blank" rel="noreferrer">
                      Link {index + 1}
                    </a>
                  ))}
                </div>
              ) : (
                <span className="no-evidence">No evidence yet</span>
              )}
            </div>
          ))
        ) : (
          <p className="muted-copy">No ratings for this task yet.</p>
        )}
      </div>
    </article>
  );
}

function AdminTaskListItem({ task, selected, onSelect }) {
  return (
    <button
      type="button"
      className={
        selected
          ? "student-list-item task-list-item active"
          : "student-list-item task-list-item"
      }
      onClick={() => onSelect(task.taskId)}
    >
      <div className="student-list-main">
        <strong>
          Task {task.taskId}: {task.title}
        </strong>
        <span className="muted-copy">
          {task.mastery} mastery, {task.unrated} unrated
        </span>
      </div>
      <div className="student-list-metrics">
        <span>{task.evidenceCount} links</span>
        <span>{task.studentsNeedingAttention.length} attention</span>
      </div>
    </button>
  );
}

function AdminStudentListItem({ student, selected, onSelect }) {
  return (
    <button
      type="button"
      className={selected ? "student-list-item active" : "student-list-item"}
      onClick={() => onSelect(student.email)}
    >
      <div className="student-list-main">
        <strong>{student.displayName || student.email}</strong>
        <span className="muted-copy">
          {student.email} · {student.groupLabel || groupLabels.unassigned}
        </span>
      </div>
      <div className="student-list-metrics">
        <span>{student.completionCount} rated</span>
        <span>{student.masteryCount} mastery</span>
      </div>
    </button>
  );
}

function AdminStudentDetail({ student, onUpdateGroup, groupSaving }) {
  const submittedResponses = sortTasksByNumber(
    student.responses.filter(
      (response) =>
        response.rating !== null || response.evidenceLinks.length > 0,
    ),
    (response) => response.taskId,
  );

  return (
    <article className="admin-card student-card">
      <div className="task-card-header">
        <div className="student-heading">
          <h3>{student.displayName || student.email}</h3>
          <p className="muted-copy">{student.email}</p>
        </div>
        <span className="task-state live">{formatDate(student.updatedAt)}</span>
      </div>

      <label className="inline-field">
        <span>Group</span>
        <select
          value={student.group || ""}
          onChange={(event) => onUpdateGroup(student.email, event.target.value)}
          disabled={groupSaving}
        >
          <option value="">Unassigned</option>
          <option value="year1">Year 1</option>
          <option value="year2">Year 2</option>
          <option value="year3">Year 3</option>
        </select>
      </label>

      <div className="coverage-grid compact">
        <span className="coverage-pill neutral">
          <strong>{student.completionCount}</strong>
          <small>Rated</small>
        </span>
        <span className="coverage-pill success">
          <strong>{student.masteryCount}</strong>
          <small>Mastery</small>
        </span>
        <span className="coverage-pill warning">
          <strong>{student.lowConfidenceCount}</strong>
          <small>Low confidence</small>
        </span>
      </div>

      <div className="response-list">
        {submittedResponses.length === 0 ? (
          <p className="muted-copy">No submissions yet.</p>
        ) : (
          submittedResponses.map((response) => (
            <div key={response.taskId} className="response-row">
              <div className="response-copy compact">
                <strong>
                  Task {response.taskId}: {response.title}
                </strong>
                <p className="muted-copy">
                  Rating:{" "}
                  {response.rating === null
                    ? "Not submitted"
                    : `${response.rating} - ${ratingLabels[response.rating]}`}
                </p>
                <p className="response-updated">
                  Updated: {formatDate(response.updatedAt)}
                </p>
              </div>

              {response.evidenceLinks.length > 0 ? (
                <div className="evidence-cluster">
                  {response.evidenceLinks.map((link, index) => (
                    <a key={link} href={link} target="_blank" rel="noreferrer">
                      Link {index + 1}
                    </a>
                  ))}
                </div>
              ) : (
                <span className="no-evidence">No evidence yet</span>
              )}
            </div>
          ))
        )}
      </div>
    </article>
  );
}

function GroupReportCard({ report, onDownload }) {
  return (
    <article className="admin-card group-report-card">
      <div className="task-card-header">
        <div>
          <h3>{report.label}</h3>
          <p className="muted-copy">
            {report.studentCount} students · {report.submittedRatings} ratings
          </p>
        </div>
        <button
          type="button"
          className="secondary-button compact-button"
          onClick={() => onDownload(report.key === "unassigned" ? "" : report.key)}
        >
          Download CSV
        </button>
      </div>

      <div className="coverage-grid compact">
        <span className="coverage-pill neutral">
          <strong>{report.studentCount}</strong>
          <small>Students</small>
        </span>
        <span className="coverage-pill neutral">
          <strong>{report.submittedRatings}</strong>
          <small>Ratings</small>
        </span>
        <span className="coverage-pill success">
          <strong>
            {report.averageScore === null ? "—" : report.averageScore.toFixed(2)}
          </strong>
          <small>Average</small>
        </span>
      </div>

      <div className="compact-report-list">
        {report.taskAverages.map((taskAverage) => (
          <div
            key={`${report.key}-${taskAverage.taskId}`}
            className="compact-report-row"
          >
            <strong>
              Task {taskAverage.taskId}: {taskAverage.title}
            </strong>
            <span className="muted-copy">
              {taskAverage.averageScore === null
                ? "No ratings"
                : `Avg ${taskAverage.averageScore.toFixed(2)} · ${taskAverage.responseCount} ratings`}
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}

function AdminTaskManagerItem({ task, selected, onSelect }) {
  return (
    <button
      type="button"
      className={
        selected ? "student-list-item task-list-item active" : "student-list-item task-list-item"
      }
      onClick={() => onSelect(task._id)}
    >
      <div className="student-list-main">
        <strong>
          Task {task._id}: {task.title}
        </strong>
        <span className="muted-copy">
          {task.resources?.course ? "Course link" : "No course"} ·{" "}
          {task.resources?.video ? "Video link" : "No video"}
        </span>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────
// APP ROOT
// ─────────────────────────────────────────────

function App() {
  const { instance, accounts } = useMsal();

  const [tasks, setTasks] = useState([]);
  const [responses, setResponses] = useState({});
  const [draftEvidence, setDraftEvidence] = useState({});
  const [tasksLoading, setTasksLoading] = useState(true);
  const [responsesLoading, setResponsesLoading] = useState(false);
  const [saveState, setSaveState] = useState({});
  const [error, setError] = useState("");

  // Role state: false | "admin" | "superAdmin"
  const [userRole, setUserRole] = useState(false);

  const [viewMode, setViewMode] = useState("student"); // student | admin | superAdmin
  const [adminData, setAdminData] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [lastAdminRefresh, setLastAdminRefresh] = useState(null);
  const [adminSearch, setAdminSearch] = useState("");
  const [selectedStudentEmail, setSelectedStudentEmail] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedManagedTaskId, setSelectedManagedTaskId] = useState("");
  const [reportGroupFilter, setReportGroupFilter] = useState("");
  const [adminCompact, setAdminCompact] = useState(true);
  const [groupSavingEmail, setGroupSavingEmail] = useState("");
  const [taskEditorMode, setTaskEditorMode] = useState("edit");
  const [taskEditorState, setTaskEditorState] = useState("idle");
  const [taskDraft, setTaskDraft] = useState({
    taskId: "",
    title: "",
    course: "",
    video: "",
  });

  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "light";
    return window.localStorage.getItem(THEME_STORAGE_KEY) || "light";
  });

  const activeAccount = instance.getActiveAccount() || accounts[0] || null;
  const userEmail = activeAccount?.username || "";
  const displayName = activeAccount?.name || userEmail;

  const isAdmin = userRole === "admin" || userRole === "superAdmin";
  const isSuperAdmin = userRole === "superAdmin";

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.body.setAttribute("data-theme", theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (!instance.getActiveAccount() && accounts.length > 0) {
      instance.setActiveAccount(accounts[0]);
    }
  }, [accounts, instance]);

  // Load tasks
  useEffect(() => {
    let cancelled = false;

    async function loadTasks() {
      setTasksLoading(true);
      try {
        const response = await fetch(`${API}/tasks`);
        if (!response.ok) throw new Error("Unable to load tasks.");
        const data = await response.json();
        if (!cancelled) setTasks(sortTasksByNumber(data, (task) => task._id));
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || "Unable to load tasks.");
      } finally {
        if (!cancelled) setTasksLoading(false);
      }
    }

    loadTasks();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load student responses
  useEffect(() => {
    let cancelled = false;

    async function loadResponses() {
      if (!userEmail) {
        setResponses({});
        setDraftEvidence({});
        return;
      }

      setResponsesLoading(true);
      setError("");

      try {
        const response = await fetch(
          `${API}/responses/${encodeURIComponent(userEmail)}`,
        );
        if (!response.ok) throw new Error("Unable to load your saved ratings.");
        const data = await response.json();
        const nextResponses = toResponseMap(data.responses || []);
        const nextEvidenceDrafts = Object.fromEntries(
          Object.entries(nextResponses).map(([taskId, taskResponse]) => [
            taskId,
            linksToTextareaValue(taskResponse.evidenceLinks || []),
          ]),
        );
        if (!cancelled) {
          setResponses(nextResponses);
          setDraftEvidence(nextEvidenceDrafts);
        }
      } catch (loadError) {
        if (!cancelled)
          setError(loadError.message || "Unable to load your saved ratings.");
      } finally {
        if (!cancelled) setResponsesLoading(false);
      }
    }

    loadResponses();
    return () => {
      cancelled = true;
    };
  }, [userEmail]);

  async function refreshAdminData(showLoading = true) {
    if (!userEmail) {
      setAdminData(null);
      setUserRole(false);
      setViewMode("student");
      setLastAdminRefresh(null);
      return;
    }

    if (showLoading) setAdminLoading(true);

    try {
      const response = await fetch(
        `${API}/admin/overview?email=${encodeURIComponent(userEmail)}`,
      );

      if (response.status === 403 || response.status === 401) {
        setUserRole(false);
        setAdminData(null);
        setViewMode("student");
        return;
      }

      if (!response.ok) throw new Error("Unable to load admin reporting.");

      const data = await response.json();
      const role = data.role || (data.isAdmin ? "admin" : false);
      setUserRole(role);
      setAdminData(data);
      setLastAdminRefresh(new Date().toISOString());
    } catch (loadError) {
      setError(loadError.message || "Unable to load admin reporting.");
    } finally {
      if (showLoading) setAdminLoading(false);
    }
  }

  // Load admin data (polls when in admin view)
  useEffect(() => {
    let intervalId = null;
    const initialLoadId = window.setTimeout(() => {
      refreshAdminData(true);
    }, 0);

    if (
      userEmail &&
      (isAdmin || viewMode === "admin" || viewMode === "superAdmin")
    ) {
      intervalId = window.setInterval(() => refreshAdminData(false), ADMIN_REFRESH_MS);
    }

    return () => {
      window.clearTimeout(initialLoadId);
      if (intervalId) window.clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail, viewMode]);

  const studentSummary = useMemo(() => {
    const total = tasks.length;
    const rated = Object.values(responses).filter(
      (r) => typeof r.rating === "number",
    ).length;
    const mastered = Object.values(responses).filter(
      (r) => r.rating === 3,
    ).length;
    return { total, rated, mastered };
  }, [responses, tasks.length]);

  const filteredAdminStudents = useMemo(() => {
    const students = adminData?.students || [];
    const query = adminSearch.trim().toLowerCase();
    if (!query) return students;
    return students.filter((student) => {
      const submitted = student.responses.filter(
        (r) => r.rating !== null || r.evidenceLinks.length > 0,
      );
      return (
        matchesSearch(student.displayName, query) ||
        matchesSearch(student.email, query) ||
        submitted.some(
          (r) =>
            matchesSearch(r.title, query) ||
            matchesSearch(r.taskId, query) ||
            r.evidenceLinks.some((link) => matchesSearch(link, query)),
        )
      );
    });
  }, [adminData, adminSearch]);

  const filteredTaskCoverage = useMemo(() => {
    const coverage = adminData?.taskCoverage || [];
    const students = adminData?.students || [];
    const query = adminSearch.trim().toLowerCase();
    const filteredCoverage = !query
      ? coverage
      : coverage.filter((task) => {
          const matchingStudents = students.filter(
            (s) =>
              matchesSearch(s.displayName, query) ||
              matchesSearch(s.email, query),
          );
          const matchingStudentHasTask = matchingStudents.some((s) =>
            s.responses.some(
              (r) =>
                r.taskId === task.taskId &&
                (r.rating !== null || r.evidenceLinks.length > 0),
            ),
          );
          return (
            matchesSearch(task.title, query) ||
            matchesSearch(task.taskId, query) ||
            task.studentsNeedingAttention.some((s) =>
              matchesSearch(s, query),
            ) ||
            matchingStudentHasTask
          );
        });
    return sortTasksByNumber(filteredCoverage, (task) => task.taskId);
  }, [adminData, adminSearch]);

  const selectedStudent = useMemo(() => {
    if (filteredAdminStudents.length === 0) return null;
    return (
      filteredAdminStudents.find((s) => s.email === selectedStudentEmail) ||
      filteredAdminStudents[0]
    );
  }, [filteredAdminStudents, selectedStudentEmail]);

  const selectedTask = useMemo(() => {
    if (filteredTaskCoverage.length === 0) return null;
    const baseTask =
      filteredTaskCoverage.find((t) => t.taskId === selectedTaskId) ||
      filteredTaskCoverage[0];
    return {
      ...baseTask,
      studentRatings:
        baseTask.studentRatings?.length > 0
          ? baseTask.studentRatings
          : buildTaskStudentRatings(baseTask.taskId, adminData?.students || []),
    };
  }, [adminData?.students, filteredTaskCoverage, selectedTaskId]);

  const availableAdminTasks = useMemo(
    () => sortTasksByNumber(adminData?.tasks || [], (task) => task._id),
    [adminData?.tasks],
  );

  const selectedManagedTask = useMemo(() => {
    if (availableAdminTasks.length === 0) return null;
    return (
      availableAdminTasks.find((task) => task._id === selectedManagedTaskId) ||
      availableAdminTasks[0]
    );
  }, [availableAdminTasks, selectedManagedTaskId]);

  const visibleGroupReports = useMemo(() => {
    const reports = adminData?.groupReports || [];
    if (!reportGroupFilter) return reports;
    return reports.filter((report) => report.key === reportGroupFilter);
  }, [adminData?.groupReports, reportGroupFilter]);

  useEffect(() => {
    const syncDraftId = window.setTimeout(() => {
    if (taskEditorMode !== "edit") return;

    if (!selectedManagedTask) {
      setTaskDraft({
        taskId: "",
        title: "",
        course: "",
        video: "",
      });
      return;
    }

    setTaskDraft({
      taskId: selectedManagedTask._id,
      title: selectedManagedTask.title || "",
      course: selectedManagedTask.resources?.course || "",
      video: selectedManagedTask.resources?.video || "",
    });
    }, 0);

    return () => window.clearTimeout(syncDraftId);
  }, [selectedManagedTask, taskEditorMode]);

  async function saveResponse(taskId, rating, evidenceText) {
    if (!userEmail) return;
    const evidenceLinks = textareaValueToLinks(evidenceText);
    setSaveState((c) => ({ ...c, [taskId]: "saving" }));
    setResponses((c) => ({
      ...c,
      [taskId]: { ...(c[taskId] || {}), taskId, rating, evidenceLinks },
    }));

    try {
      const response = await fetch(`${API}/responses/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userEmail,
          displayName,
          rating,
          evidenceLinks,
        }),
      });
      if (!response.ok) throw new Error("Unable to save this task right now.");
      const data = await response.json();
      const savedResponse =
        data.student.responses.find((e) => e.taskId === taskId) || null;
      if (savedResponse) {
        setResponses((c) => ({ ...c, [taskId]: savedResponse }));
        setDraftEvidence((c) => ({
          ...c,
          [taskId]: linksToTextareaValue(savedResponse.evidenceLinks || []),
        }));
      }
      setSaveState((c) => ({ ...c, [taskId]: "saved" }));
      window.setTimeout(() => {
        setSaveState((c) => {
          if (c[taskId] !== "saved") return c;
          return { ...c, [taskId]: "idle" };
        });
      }, 1800);
    } catch (saveError) {
      setSaveState((c) => ({ ...c, [taskId]: "error" }));
      setError(saveError.message || "Unable to save this task right now.");
    }
  }

  async function handleUpdateStudentGroup(email, group) {
    if (!userEmail) return;
    setGroupSavingEmail(email);
    setError("");

    try {
      const response = await fetch(
        `${API}/admin/students/${encodeURIComponent(email)}/group?email=${encodeURIComponent(userEmail)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ group }),
        },
      );

      if (!response.ok) throw new Error("Unable to update student group.");
      await refreshAdminData(false);
    } catch (groupError) {
      setError(groupError.message || "Unable to update student group.");
    } finally {
      setGroupSavingEmail("");
    }
  }

  async function handleDownloadReport(group = "") {
    if (!userEmail) return;

    try {
      const query = new URLSearchParams({ email: userEmail });
      if (group) query.set("group", group);
      const response = await fetch(`${API}/admin/report.csv?${query.toString()}`);
      if (!response.ok) throw new Error("Unable to download report.");
      const blob = await response.blob();
      downloadBlob(blob, `${group || "all-groups"}-task-report.csv`);
    } catch (reportError) {
      setError(reportError.message || "Unable to download report.");
    }
  }

  function startCreateTask() {
    setTaskEditorMode("create");
    setTaskDraft({
      taskId: "",
      title: "",
      course: "",
      video: "",
    });
    setSelectedManagedTaskId("");
  }

  function startEditTask(task) {
    setTaskEditorMode("edit");
    setSelectedManagedTaskId(task?._id || "");
  }

  async function handleSaveTask() {
    if (!userEmail) return;
    setTaskEditorState("saving");
    setError("");

    try {
      const endpoint =
        taskEditorMode === "create"
          ? `${API}/admin/tasks?email=${encodeURIComponent(userEmail)}`
          : `${API}/admin/tasks/${encodeURIComponent(taskDraft.taskId)}?email=${encodeURIComponent(userEmail)}`;
      const method = taskEditorMode === "create" ? "POST" : "PUT";

      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(taskDraft),
      });

      if (!response.ok) throw new Error("Unable to save task.");

      const data = await response.json();
      setTasks(data.tasks || []);
      if (taskEditorMode === "create") {
        setSelectedManagedTaskId(taskDraft.taskId);
        setTaskEditorMode("edit");
      }
      setTaskEditorState("saved");
      await refreshAdminData(false);
      window.setTimeout(() => setTaskEditorState("idle"), 1500);
    } catch (taskError) {
      setTaskEditorState("error");
      setError(taskError.message || "Unable to save task.");
    }
  }

  async function handleDeleteTask() {
    if (!userEmail || !selectedManagedTask) return;
    setTaskEditorState("saving");
    setError("");

    try {
      const response = await fetch(
        `${API}/admin/tasks/${encodeURIComponent(selectedManagedTask._id)}?email=${encodeURIComponent(userEmail)}`,
        { method: "DELETE" },
      );

      if (!response.ok) throw new Error("Unable to delete task.");

      const data = await response.json();
      setTasks(data.tasks || []);
      setSelectedManagedTaskId("");
      setTaskEditorState("saved");
      await refreshAdminData(false);
      window.setTimeout(() => setTaskEditorState("idle"), 1500);
    } catch (taskError) {
      setTaskEditorState("error");
      setError(taskError.message || "Unable to delete task.");
    }
  }

  const login = () => instance.loginRedirect(loginRequest);
  const logout = () => {
    try {
      instance.clearCache();
    } catch (e) {
      console.error("Failed to clear MSAL cache", e);
    }
    // Always reset the active account so the UI shows the login screen
    instance.setActiveAccount(null);
  };
  const toggleTheme = () => setTheme((t) => (t === "light" ? "dark" : "light"));

  // Role label for the account card
  const roleLabel = isSuperAdmin
    ? "Super Admin"
    : isAdmin
      ? "Admin"
      : "Student";

  return (
    <main className={`app-shell theme-${theme}`}>
      {/* ── HERO ── */}
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Student self-assessment</p>
          <h1>Track task confidence, evidence, and progress in one place.</h1>
          <p className="intro">
            Students sign in with Microsoft, rate each task from 0 to 3, and
            attach evidence links. Admins get a live dashboard that refreshes as
            students submit updates.
          </p>
        </div>

        <div className="hero-actions">
          <button type="button" className="theme-toggle" onClick={toggleTheme}>
            {theme === "light" ? "Dark mode" : "Light mode"}
          </button>

          {!userEmail ? (
            <button className="primary-button" onClick={login}>
              Sign in with Microsoft
            </button>
          ) : (
            <>
              <div className="account-card">
                <span className="account-label">Signed in as</span>
                <strong>{displayName}</strong>
                <span className="account-email">{userEmail}</span>
                <span
                  className={`account-role ${
                    isSuperAdmin
                      ? "account-role--super"
                      : isAdmin
                        ? "account-role--admin"
                        : ""
                  }`}
                >
                  {roleLabel}
                </span>
              </div>
              <button className="secondary-button" onClick={logout}>
                Sign out
              </button>
            </>
          )}
        </div>
      </section>

      {/* ── VIEW TABS ── */}
      {userEmail && isAdmin ? (
        <section className="view-toggle">
          <button
            type="button"
            className={
              viewMode === "student" ? "tab-button active" : "tab-button"
            }
            onClick={() => setViewMode("student")}
          >
            My ratings
          </button>
          <button
            type="button"
            className={
              viewMode === "admin" ? "tab-button active" : "tab-button"
            }
            onClick={() => setViewMode("admin")}
          >
            Admin dashboard
          </button>
          {isSuperAdmin ? (
            <button
              type="button"
              className={
                viewMode === "superAdmin"
                  ? "tab-button active tab-button--super"
                  : "tab-button tab-button--super"
              }
              onClick={() => setViewMode("superAdmin")}
            >
              Manage admins
            </button>
          ) : null}
        </section>
      ) : null}

      {error ? <p className="status-banner error">{error}</p> : null}

      {/* ── SUPER ADMIN VIEW ── */}
      {viewMode === "superAdmin" && isSuperAdmin ? (
        <>
          <section className="dashboard-banner">
            <div>
              <p className="eyebrow">Super Admin</p>
              <h2>Manage who can access the admin dashboard.</h2>
            </div>
            <p className="dashboard-meta">
              Only super admins can see this panel or modify access.
            </p>
          </section>
          <SuperAdminPanel currentUserEmail={userEmail} />
        </>
      ) : /* ── ADMIN VIEW ── */
      !userEmail ? (
        <section className="empty-state">
          <h2>Microsoft login is required before students can rate tasks.</h2>
          <p>
            Once signed in, saved ratings and evidence links will load
            automatically for that Microsoft account.
          </p>
        </section>
      ) : viewMode === "admin" && isAdmin ? (
        <>
          <section className="summary-strip admin-summary-strip">
            <article>
              <span>Students</span>
              <strong>{adminData?.summary.studentCount ?? 0}</strong>
            </article>
            <article>
              <span>Submitted ratings</span>
              <strong>{adminData?.summary.submittedRatings ?? 0}</strong>
            </article>
            <article>
              <span>Evidence links</span>
              <strong>{adminData?.summary.evidenceLinks ?? 0}</strong>
            </article>
          </section>

          <section className="dashboard-banner">
            <div>
              <p className="eyebrow">Live dashboard</p>
              <h2>Admin dashboard updates automatically.</h2>
            </div>
            <p className="dashboard-meta">
              Refresh cadence: every {ADMIN_REFRESH_MS / 1000} seconds.
              <br />
              Last update: {formatDate(lastAdminRefresh)}
            </p>
          </section>

          {adminLoading || !adminData ? (
            <section className="empty-state">
              <h2>Loading admin reporting...</h2>
              <p>Gathering student submissions and task coverage.</p>
            </section>
          ) : (
            <div
              className={
                adminCompact ? "admin-layout compact-admin-layout" : "admin-layout"
              }
            >
              <section className="admin-section">
                <div className="section-heading">
                  <h2>Search</h2>
                  <p className="muted-copy">
                    Filter students, tasks, or evidence links from one place.
                  </p>
                </div>
                <div className="admin-toolbar">
                  <label className="search-block">
                    <span className="sr-only">Search admin dashboard</span>
                    <input
                      type="search"
                      value={adminSearch}
                      onChange={(e) => setAdminSearch(e.target.value)}
                      placeholder="Search students, tasks, or links"
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    onClick={() => setAdminCompact((current) => !current)}
                  >
                    {adminCompact ? "Expanded view" : "Compact view"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    onClick={() => handleDownloadReport("")}
                  >
                    Download full CSV
                  </button>
                </div>
              </section>

              <section className="admin-section">
                <div className="section-heading">
                  <h2>Group reports</h2>
                  <p className="muted-copy">
                    Average scores by cohort, plus downloadable CSV reports.
                  </p>
                </div>
                <div className="reports-toolbar">
                  <label className="inline-field">
                    <span>Filter group</span>
                    <select
                      value={reportGroupFilter}
                      onChange={(event) => setReportGroupFilter(event.target.value)}
                    >
                      <option value="">All groups</option>
                      {(adminData.groups || []).map((group) => (
                        <option key={group.key} value={group.key}>
                          {group.label}
                        </option>
                      ))}
                      <option value="unassigned">Unassigned</option>
                    </select>
                  </label>
                </div>
                <div className="group-report-grid">
                  {visibleGroupReports.map((report) => (
                    <GroupReportCard
                      key={report.key}
                      report={report}
                      onDownload={handleDownloadReport}
                    />
                  ))}
                </div>
              </section>

              <section className="admin-section">
                <div className="section-heading">
                  <h2>Task coverage</h2>
                  <p className="muted-copy">
                    Compact view of low confidence and missing submissions.
                  </p>
                </div>
                <div className="admin-student-layout admin-task-layout">
                  <div className="student-list task-list">
                    {filteredTaskCoverage.map((task) => (
                      <AdminTaskListItem
                        key={task.taskId}
                        task={task}
                        selected={task.taskId === selectedTask?.taskId}
                        onSelect={setSelectedTaskId}
                      />
                    ))}
                    {filteredTaskCoverage.length === 0 ? (
                      <p className="muted-copy">
                        No tasks match the current search.
                      </p>
                    ) : null}
                  </div>
                  <div className="student-detail-panel">
                    {selectedTask ? (
                      <AdminCoverageCard task={selectedTask} />
                    ) : (
                      <section className="empty-state">
                        <h2>No task selected</h2>
                        <p>
                          Choose a task from the list to view coverage details.
                        </p>
                      </section>
                    )}
                  </div>
                </div>
              </section>

              <section className="admin-section">
                <div className="section-heading">
                  <h2>Student submissions</h2>
                  <p className="muted-copy">
                    Select a student to inspect their ratings and evidence.
                  </p>
                </div>
                <div className="admin-student-layout">
                  <div className="student-list">
                    {filteredAdminStudents.map((student) => (
                      <AdminStudentListItem
                        key={student.email}
                        student={student}
                        selected={student.email === selectedStudentEmail}
                        onSelect={setSelectedStudentEmail}
                      />
                    ))}
                    {filteredAdminStudents.length === 0 ? (
                      <p className="muted-copy">
                        No students match the current search.
                      </p>
                    ) : null}
                  </div>
                  <div className="student-detail-panel">
                    {selectedStudent ? (
                      <AdminStudentDetail
                        student={selectedStudent}
                        onUpdateGroup={handleUpdateStudentGroup}
                        groupSaving={groupSavingEmail === selectedStudent.email}
                      />
                    ) : (
                      <section className="empty-state">
                        <h2>No student selected</h2>
                        <p>
                          Choose a student from the list to view their tasks.
                        </p>
                      </section>
                    )}
                  </div>
                </div>
              </section>

              <section className="admin-section">
                <div className="section-heading">
                  <h2>Manage tasks</h2>
                  <p className="muted-copy">
                    Add new tasks or update existing titles and resource links.
                  </p>
                </div>
                <div className="admin-student-layout admin-task-layout">
                  <div className="student-list task-list">
                    <button
                      type="button"
                      className={
                        taskEditorMode === "create"
                          ? "student-list-item task-list-item active"
                          : "student-list-item task-list-item"
                      }
                      onClick={startCreateTask}
                    >
                      <div className="student-list-main">
                        <strong>Add task</strong>
                        <span className="muted-copy">
                          Create a new numbered task
                        </span>
                      </div>
                    </button>
                    {availableAdminTasks.map((task) => (
                      <AdminTaskManagerItem
                        key={task._id}
                        task={task}
                        selected={
                          taskEditorMode === "edit" &&
                          task._id === selectedManagedTask?._id
                        }
                        onSelect={() => startEditTask(task)}
                      />
                    ))}
                  </div>
                  <div className="student-detail-panel">
                    <article className="admin-card">
                      <div className="task-card-header">
                        <div>
                          <h3>
                            {taskEditorMode === "create"
                              ? "Create task"
                              : `Edit task ${selectedManagedTask?._id || ""}`}
                          </h3>
                          <p className="muted-copy">
                            {taskEditorMode === "create"
                              ? "Add a task number, title, and optional learning links."
                              : "Update the selected task or remove it entirely."}
                          </p>
                        </div>
                        <span className={`task-state ${taskEditorState}`}>
                          {taskEditorState === "saving" && "Saving..."}
                          {taskEditorState === "saved" && "Saved"}
                          {taskEditorState === "error" && "Retry needed"}
                          {taskEditorState === "idle" && "Ready"}
                        </span>
                      </div>

                      <div className="task-editor-grid">
                        <label className="inline-field">
                          <span>Task number</span>
                          <input
                            type="text"
                            value={taskDraft.taskId}
                            onChange={(event) =>
                              setTaskDraft((current) => ({
                                ...current,
                                taskId: event.target.value,
                              }))
                            }
                            disabled={taskEditorMode === "edit"}
                          />
                        </label>
                        <label className="inline-field">
                          <span>Title</span>
                          <input
                            type="text"
                            value={taskDraft.title}
                            onChange={(event) =>
                              setTaskDraft((current) => ({
                                ...current,
                                title: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="inline-field">
                          <span>Course link</span>
                          <input
                            type="url"
                            value={taskDraft.course}
                            onChange={(event) =>
                              setTaskDraft((current) => ({
                                ...current,
                                course: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="inline-field">
                          <span>Video link</span>
                          <input
                            type="url"
                            value={taskDraft.video}
                            onChange={(event) =>
                              setTaskDraft((current) => ({
                                ...current,
                                video: event.target.value,
                              }))
                            }
                          />
                        </label>
                      </div>

                      <div className="task-editor-actions">
                        <button
                          type="button"
                          className="primary-button"
                          onClick={handleSaveTask}
                          disabled={!taskDraft.taskId.trim() || !taskDraft.title.trim()}
                        >
                          {taskEditorMode === "create" ? "Create task" : "Save changes"}
                        </button>
                        {taskEditorMode === "edit" ? (
                          <button
                            type="button"
                            className="secondary-button danger-button"
                            onClick={handleDeleteTask}
                          >
                            Delete task
                          </button>
                        ) : null}
                      </div>
                    </article>
                  </div>
                </div>
              </section>
            </div>
          )}
        </>
      ) : /* ── STUDENT VIEW ── */
      tasksLoading || responsesLoading ? (
        <section className="empty-state">
          <h2>Loading your task list...</h2>
          <p>Fetching tasks and any ratings you have already saved.</p>
        </section>
      ) : (
        <>
          <section className="summary-strip">
            <article>
              <span>Total tasks</span>
              <strong>{studentSummary.total}</strong>
            </article>
            <article>
              <span>Rated</span>
              <strong>{studentSummary.rated}</strong>
            </article>
            <article>
              <span>Mastery</span>
              <strong>{studentSummary.mastered}</strong>
            </article>
          </section>

          <section className="task-grid">
            {tasks.map((task) => (
              <StudentTaskCard
                key={task._id}
                task={task}
                currentResponse={responses[task._id]}
                evidenceValue={
                  draftEvidence[task._id] ??
                  linksToTextareaValue(responses[task._id]?.evidenceLinks || [])
                }
                taskSaveState={saveState[task._id] || "idle"}
                onChangeEvidence={(taskId, value) =>
                  setDraftEvidence((c) => ({ ...c, [taskId]: value }))
                }
                onSaveResponse={saveResponse}
              />
            ))}
          </section>
        </>
      )}

      <footer className="footer">
        <div className="footer-content">
          <h3 id="footer-text">Developed by Coby Hughes</h3>
          <a
            href="https://github.com/c-o-b-a-x"
            target="_blank"
            rel="noreferrer"
            className="github-link"
          >
            <img
              src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/github/github-original.svg"
              alt="GitHub Logo"
              className="github-logo"
            />
          </a>
        </div>
      </footer>
    </main>
  );
}

export default App;
