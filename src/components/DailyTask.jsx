import React, { useEffect, useState, useRef } from "react";

// Daily Task Time Scheduler — v2
// Single-file React component (default export). Tailwind classes used for styling.
// Features added:
// - Edit existing tasks (inline edit modal)
// - Persist tasks by date (each calendar day is a separate "page")
// - Name suggestions from historical task names (autocomplete via datalist)
// - History page showing previous days (read-only) with tables
// - Bar chart comparing scheduled vs completed hours across days (recharts)
// - Browser notifications at task start and end times (while app is open / tab in foreground)
// - CSV export/import and per-day reset
// Usage: paste into a Vite/CRA React app (ensure Tailwind + recharts installed) and render <DailyTaskPlannerV2 />.

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ---------- helpers ----------
function timeToMinutes(timeStr) {
  if (!timeStr) return null;
  const [hh, mm] = timeStr.split(":");
  return parseInt(hh || "0", 10) * 60 + parseInt(mm || "0", 10);
}
function minutesToTime(mins) {
  if (mins == null || isNaN(mins)) return "--:--";
  if (mins < 0) mins = 0;
  if (mins > 24 * 60) mins = 24 * 60;
  const h = Math.floor(mins / 60)
    .toString()
    .padStart(2, "0");
  const m = Math.floor(mins % 60)
    .toString()
    .padStart(2, "0");
  if (h === "24") return "23:59";
  return `${h}:${m}`;
}
function minutesToReadable(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.length ? parts.join(" ") : "0m";
}
function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

// localStorage key
const STORAGE_KEY = "daily-tasks-v2";

// ---------- component ----------
export default function DailyTaskPlannerV2() {
  const [data, setData] = useState({}); // { '2025-10-27': [task,...], ... }
  const [currentDate, setCurrentDate] = useState(todayISO());
  const [name, setName] = useState("");
  const [durHours, setDurHours] = useState(0);
  const [durMinutes, setDurMinutes] = useState(30);
  const [startTime, setStartTime] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState("today"); // 'today' | 'history'
  const [editTask, setEditTask] = useState(null); // task object when editing
  const [notificationPerm, setNotificationPerm] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );
  const timersRef = useRef({}); // store scheduled timers so we can clear them

  // load from storage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setData(JSON.parse(raw));
    } catch (e) {
      console.warn("Could not load tasks", e);
    }
  }, []);

  // save when data changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  // re-schedule notifications when tasks or date change
  useEffect(() => {
    clearAllTimers();
    if (notificationPerm === "granted")
      scheduleNotificationsForDate(currentDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, currentDate, notificationPerm]);

  // ---------- utilities ----------
  const tasksForDate = (date) => data[date] || [];

  const previousEndMinutes = (() => {
    const list = tasksForDate(currentDate);
    return list.length ? timeToMinutes(list[list.length - 1].endTime) : null;
  })();

  const startMinAttr = previousEndMinutes
    ? minutesToTime(previousEndMinutes)
    : "00:00";

  function calcEndTimeFromStart(startStr, durMin) {
    const startMin = timeToMinutes(startStr);
    if (startMin == null || isNaN(startMin)) return null;
    const endMin = startMin + durMin;
    if (endMin > 24 * 60) return null; // goes past day
    return minutesToTime(endMin);
  }

  function addOrUpdateTask(e) {
    e && e.preventDefault();
    setError("");
    const duration = Number(durHours) * 60 + Number(durMinutes);
    if (!name.trim()) return setError("Give the task a name.");
    if (!startTime) return setError("Pick a start time.");
    if (duration <= 0) return setError("Duration must be greater than 0.");

    const startMin = timeToMinutes(startTime);
    const list = tasksForDate(currentDate);

    // if creating a new task ensure it doesn't start before previous end
    if (
      !editTask &&
      list.length &&
      startMin < timeToMinutes(list[list.length - 1].endTime)
    ) {
      return setError(
        "Start time cannot be earlier than the previous task's end time."
      );
    }

    const endTime = calcEndTimeFromStart(startTime, duration);
    if (!endTime)
      return setError(
        "Task would end past midnight. Pick a shorter duration or earlier start."
      );

    if (editTask) {
      // update existing
      const updated = list.map((t) =>
        t.id === editTask.id
          ? {
              ...t,
              name: name.trim(),
              durationMinutes: duration,
              startTime,
              endTime,
            }
          : t
      );
      setData((d) => ({ ...d, [currentDate]: updated }));
      setEditTask(null);
    } else {
      const newTask = {
        id: Date.now() + Math.random().toString(36).slice(2, 7),
        name: name.trim(),
        durationMinutes: duration,
        startTime,
        endTime,
        done: false,
      };
      setData((d) => ({
        ...d,
        [currentDate]: [...tasksForDate(currentDate), newTask],
      }));
      setStartTime(endTime); // auto chain
    }

    // reset fields for next entry
    setName("");
    setDurHours(0);
    setDurMinutes(30);
  }

  function toggleDone(date, id) {
    setData((d) => ({
      ...d,
      [date]: d[date].map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    }));
  }

  function removeTask(date, id) {
    setData((d) => ({ ...d, [date]: d[date].filter((t) => t.id !== id) }));
  }

  function startEdit(task) {
    setEditTask(task);
    setName(task.name);
    setDurHours(Math.floor(task.durationMinutes / 60));
    setDurMinutes(task.durationMinutes % 60);
    setStartTime(task.startTime);
    setView("today");
  }

  function cancelEdit() {
    setEditTask(null);
    setName("");
    setDurHours(0);
    setDurMinutes(30);
    setStartTime("");
    setError("");
  }

  function setStartToPreviousEnd() {
    if (previousEndMinutes == null) return setStartTime("00:00");
    setStartTime(minutesToTime(previousEndMinutes));
  }

  function clearAllTimers() {
    const timers = timersRef.current;
    Object.values(timers).forEach(({ start, end }) => {
      if (start) clearTimeout(start);
      if (end) clearTimeout(end);
    });
    timersRef.current = {};
  }

  function requestNotificationPermission() {
    if (!("Notification" in window))
      return alert("This browser does not support notifications.");
    Notification.requestPermission().then((perm) => setNotificationPerm(perm));
  }

  function scheduleNotificationsForDate(date) {
    clearAllTimers();
    if (notificationPerm !== "granted") return;

    const now = new Date();
    const list = tasksForDate(date);
    list.forEach((task) => {
      // compute ms till start
      const [sh, sm] = task.startTime.split(":").map((s) => Number(s));
      const [eh, em] = task.endTime.split(":").map((s) => Number(s));

      const startDate = new Date();
      startDate.setHours(sh, sm, 0, 0);
      const endDate = new Date();
      endDate.setHours(eh, em, 0, 0);

      const startDelta = startDate - now;
      const endDelta = endDate - now;

      const timers = timersRef.current;
      const entry = {};
      if (startDelta > 0 && startDelta < 24 * 3600 * 1000) {
        entry.start = setTimeout(() => {
          new Notification(`Task starting: ${task.name}`, {
            body: `${task.startTime} → ${task.endTime}`,
          });
        }, startDelta);
      }
      if (endDelta > 0 && endDelta < 24 * 3600 * 1000) {
        entry.end = setTimeout(() => {
          new Notification(`Task ended: ${task.name}`, {
            body: `${task.startTime} → ${task.endTime}`,
          });
        }, endDelta);
      }
      if (entry.start || entry.end) timers[task.id] = entry;
    });
  }

  // ---------- history & analytics ----------
  function uniqueNames() {
    const all = Object.values(data).flat();
    const uniq = Array.from(new Set(all.map((t) => t.name))).sort();
    return uniq;
  }

  function buildChartData() {
    // produce [{date: '2025-10-26', scheduled: X, completed: Y}, ...]
    const rows = Object.keys(data)
      .sort()
      .map((date) => {
        const list = data[date];
        const scheduled =
          list.reduce((s, t) => s + Number(t.durationMinutes || 0), 0) / 60;
        const completed =
          list.reduce(
            (s, t) => s + (t.done ? Number(t.durationMinutes || 0) : 0),
            0
          ) / 60;
        return {
          date,
          scheduled: Number(scheduled.toFixed(2)),
          completed: Number(completed.toFixed(2)),
        };
      });
    return rows;
  }

  function exportCSV() {
    const rows = [];
    Object.keys(data)
      .sort()
      .forEach((date) => {
        const list = data[date];
        list.forEach((t) => {
          rows.push(
            [
              date,
              t.name,
              t.startTime,
              t.endTime,
              t.durationMinutes,
              t.done ? 1 : 0,
            ].join(",")
          );
        });
      });
    const csv = ["date,name,start,end,durationMinutes,done", ...rows].join(
      "\n"
    );

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "daily-tasks-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importCSV(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split(/\n/).filter(Boolean);
      const out = { ...data };
      // skip header if present
      const startAt = lines[0] && lines[0].startsWith("date,") ? 1 : 0;
      for (let i = startAt; i < lines.length; i++) {
        const [date, name_, start, end, durationStr, doneStr] =
          lines[i].split(",");
        if (!date) continue;
        if (!out[date]) out[date] = [];
        out[date].push({
          id: Date.now() + Math.random().toString(36).slice(2, 7) + i,
          name: name_ || "Imported",
          startTime: start || "00:00",
          endTime: end || "00:00",
          durationMinutes: Number(durationStr) || 0,
          done: doneStr === "1",
        });
      }
      setData(out);
    };
    reader.readAsText(file);
  }

  function resetDay(date) {
    if (!confirm("Clear all tasks for " + date + "?")) return;
    setData((d) => ({ ...d, [date]: [] }));
  }

  // ---------- computed totals ----------
  const totalMinutes = tasksForDate(currentDate).reduce(
    (s, t) => s + Number(t.durationMinutes || 0),
    0
  );
  const remainingMinutes = Math.max(0, 24 * 60 - totalMinutes);

  // ---------- UI ----------
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white p-6 sm:p-10">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Daily Task Scheduler — Smart
            </h1>
            <p className="text-slate-500 mt-1">
              Plan, track, and review past days. Suggestions, charts, and
              notifications included.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={view}
              onChange={(e) => setView(e.target.value)}
              className="rounded-md border px-3 py-2"
            >
              <option value="today">Today</option>
              <option value="history">History</option>
            </select>

            <input
              type="date"
              value={currentDate}
              onChange={(e) => setCurrentDate(e.target.value)}
              className="rounded-md border px-3 py-2"
            />

            <button
              onClick={requestNotificationPermission}
              className="rounded-md px-3 py-2 border"
            >
              Notify: {notificationPerm}
            </button>

            <div className="flex gap-2">
              <button
                onClick={exportCSV}
                className="px-3 py-2 rounded-md bg-sky-600 text-white"
              >
                Export CSV
              </button>

              <label className="px-3 py-2 rounded-md border cursor-pointer">
                Import
                <input
                  type="file"
                  accept="text/csv"
                  onChange={(e) => importCSV(e.target.files[0])}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </header>

        {view === "today" ? (
          <div className="grid gap-6 md:grid-cols-2">
            <form
              onSubmit={addOrUpdateTask}
              className="bg-white p-5 rounded-2xl shadow-md ring-1 ring-slate-100 flex flex-col gap-4"
            >
              <div>
                <label className="text-sm text-slate-600">Task name</label>
                <input
                  list="names-suggest"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Reading, Workout"
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
                <datalist id="names-suggest">
                  {uniqueNames().map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-sm text-slate-600">Hours</label>
                  <input
                    type="number"
                    min={0}
                    max={24}
                    value={durHours}
                    onChange={(e) => setDurHours(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600">Minutes</label>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={durMinutes}
                    onChange={(e) => setDurMinutes(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600">Start time</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    min={startMinAttr}
                    max="23:59"
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={setStartToPreviousEnd}
                      className="text-xs px-2 py-1 rounded-md border hover:bg-slate-50"
                    >
                      Use previous end
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStartTime("");
                      }}
                      className="text-xs px-2 py-1 rounded-md border hover:bg-slate-50"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 justify-between">
                <div className="text-sm text-slate-500">
                  End time will be auto-calculated after adding.
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    className="rounded-lg bg-sky-600 text-white px-4 py-2 text-sm hover:brightness-105"
                  >
                    {editTask ? "Update task" : "Add task"}
                  </button>

                  {editTask ? (
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="text-sm px-3 py-2 rounded-lg border"
                    >
                      Cancel
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setName("");
                        setDurHours(0);
                        setDurMinutes(30);
                        setStartTime("");
                        setError("");
                      }}
                      className="text-sm px-3 py-2 rounded-lg border"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              {error && <div className="text-sm text-red-600">{error}</div>}

              <div className="mt-2 border-t pt-3 text-sm text-slate-600">
                <div>
                  Total scheduled:{" "}
                  <strong>{minutesToReadable(totalMinutes)}</strong>
                </div>
                <div>
                  Time left in day:{" "}
                  <strong>{minutesToReadable(remainingMinutes)}</strong>
                </div>
              </div>

              <div className="mt-2 text-xs text-slate-500">
                Tip: Use the autocomplete suggestions above to reuse names from
                past days.
              </div>
            </form>

            <div className="flex flex-col gap-4">
              <div className="bg-white p-4 rounded-2xl shadow-md ring-1 ring-slate-100">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-medium">
                      {currentDate} — Summary
                    </h3>
                    <p className="text-sm text-slate-500">
                      Tasks: {tasksForDate(currentDate).length} • Total:{" "}
                      {minutesToReadable(totalMinutes)}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-slate-500 text-sm">Left</div>
                    <div className="font-semibold text-lg">
                      {minutesToReadable(remainingMinutes)}
                    </div>
                  </div>
                </div>

                <div className="mt-4 h-3 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    style={{
                      width: `${Math.min(
                        100,
                        (totalMinutes / (24 * 60)) * 100
                      )}%`,
                    }}
                    className="h-full rounded-full bg-sky-400"
                  />
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl shadow-md ring-1 ring-slate-100">
                <h3 className="font-medium mb-3">Tasks</h3>
                {tasksForDate(currentDate).length === 0 && (
                  <div className="text-sm text-slate-500">
                    No tasks yet — add your first task.
                  </div>
                )}

                <ul className="flex flex-col gap-3">
                  {tasksForDate(currentDate).map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between gap-3"
                    >
                      <div className="flex items-start gap-3">
                        <input
                          id={`chk-${t.id}`}
                          type="checkbox"
                          checked={t.done}
                          onChange={() => toggleDone(currentDate, t.id)}
                          className="mt-1 w-4 h-4"
                        />
                        <div>
                          <div
                            className={`font-medium ${
                              t.done ? "line-through text-slate-400" : ""
                            }`}
                          >
                            {t.name}
                          </div>
                          <div className="text-xs text-slate-500">
                            {t.startTime} → {t.endTime} •{" "}
                            {minutesToReadable(t.durationMinutes)}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => startEdit(t)}
                          className="text-xs px-2 py-1 rounded-md border"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removeTask(currentDate, t.id)}
                          className="text-xs px-2 py-1 rounded-md border text-red-600"
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => resetDay(currentDate)}
                    className="px-3 py-2 rounded-md border text-sm"
                  >
                    Clear day
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          // history view
          <div className="space-y-6">
            <div className="bg-white p-4 rounded-2xl shadow-md ring-1 ring-slate-100">
              <h3 className="text-lg font-medium">History & Analytics</h3>
              <p className="text-sm text-slate-500">
                View previous days (read-only) and a chart of scheduled vs
                completed hours.
              </p>
              <div style={{ height: 260 }} className="mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={buildChartData()}>
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="scheduled" name="Scheduled (h)" />
                    <Bar dataKey="completed" name="Completed (h)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid gap-4">
              {Object.keys(data)
                .sort((a, b) => (a < b ? 1 : -1))
                .map((date) => (
                  <div
                    key={date}
                    className="bg-white p-4 rounded-2xl shadow-md ring-1 ring-slate-100"
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium">{date}</h4>
                      <div className="text-sm text-slate-500">
                        Tasks: {tasksForDate(date).length}
                      </div>
                    </div>

                    <div className="mt-3 overflow-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-slate-500">
                            <th className="px-2 py-1">Name</th>
                            <th className="px-2 py-1">Start</th>
                            <th className="px-2 py-1">End</th>
                            <th className="px-2 py-1">Duration</th>
                            <th className="px-2 py-1">Done</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tasksForDate(date).map((t) => (
                            <tr key={t.id} className="border-t">
                              <td className="px-2 py-2">{t.name}</td>
                              <td className="px-2 py-2">{t.startTime}</td>
                              <td className="px-2 py-2">{t.endTime}</td>
                              <td className="px-2 py-2">
                                {minutesToReadable(t.durationMinutes)}
                              </td>
                              <td className="px-2 py-2">
                                {t.done ? "✅" : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        <footer className="mt-6 text-sm text-slate-500 text-center">
          Suggestions: try the CSV export to back up your history. Notifications
          work while the page is open and permissioned.
        </footer>
      </div>
    </div>
  );
}
