import React, { useEffect, useState, useRef } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

type NotificationPerm = NotificationPermission;

interface Task {
  id: string;
  name: string;
  durationMinutes: number;
  startTime: string;
  endTime: string;
  done: boolean;
}

type DataMap = Record<string, Task[]>;

// ---------- helpers ----------
function timeToMinutes(timeStr?: string | null): number | null {
  if (!timeStr) return null;
  const [hh, mm] = timeStr.split(":");
  return parseInt(hh || "0", 10) * 60 + parseInt(mm || "0", 10);
}
function minutesToTime(mins: number | null | undefined): string {
  if (mins == null || isNaN(mins as number)) return "--:--";
  let m = mins as number;
  if (m < 0) m = 0;
  if (m > 24 * 60) m = 24 * 60;
  const h = Math.floor(m / 60)
    .toString()
    .padStart(2, "0");
  const mm = Math.floor(m % 60)
    .toString()
    .padStart(2, "0");
  if (h === "24") return "23:59";
  return `${h}:${mm}`;
}
function minutesToReadable(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.length ? parts.join(" ") : "0m";
}
function formatTime12(timeStr?: string | null): string {
  if (!timeStr) return "--:--";
  if (!/^\d{1,2}:\d{2}$/.test(timeStr)) return timeStr;
  const [hh, mm] = timeStr.split(":");
  const h = Number(hh);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${ampm}`;
}
function todayISO(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

// localStorage key
const STORAGE_KEY = "daily-tasks-v2";

// ---------- component ----------
export default function DailyTaskPlannerV2() {
  const [data, setData] = useState<DataMap>(() => {
    // Hydrate from localStorage synchronously to avoid a race where the
    // save-effect writes the initial empty object before we read stored data.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as DataMap) : {};
    } catch (err) {
      console.warn("Could not load tasks from storage", err);
      return {};
    }
  }); // { '2025-10-27': [task,...], ... }
  const [currentDate, setCurrentDate] = useState<string>(todayISO());
  const [name, setName] = useState<string>("");
  const [durHours, setDurHours] = useState<number>(0);
  const [durMinutes, setDurMinutes] = useState<number>(30);
  const [startTime, setStartTime] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [view, setView] = useState<"today" | "history">("today");
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [notificationPerm, setNotificationPerm] = useState<NotificationPerm>(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );
  const timersRef = useRef<Record<string, { start?: number; end?: number }>>(
    {}
  ); // store scheduled timers so we can clear them

  // NOTE: initial hydration is done in the useState lazy initializer above to
  // avoid clobbering stored data with the empty initial state on first mount.

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
  const tasksForDate = (date: string): Task[] => data[date] || [];

  const previousEndMinutes: number | null = (() => {
    const list = tasksForDate(currentDate);
    return list.length ? timeToMinutes(list[list.length - 1].endTime) : null;
  })();

  type PendingForm = {
    name: string;
    durationMinutes: number;
    startTime: string;
    endTime: string;
    isEdit: boolean;
    editId?: string | null;
  } | null;

  const [bedtimeModalOpen, setBedtimeModalOpen] = useState(false);
  const [pendingForm, setPendingForm] = useState<PendingForm>(null);
  function calcEndTimeFromStart(
    startStr: string,
    durMin: number
  ): string | null {
    const startMin = timeToMinutes(startStr);
    if (startMin == null || isNaN(startMin)) return null;
    const endMin = startMin + durMin;
    if (endMin > 24 * 60) return null; // goes past day
    return minutesToTime(endMin);
  }

  function commitTask(form: Exclude<PendingForm, null>) {
    const list = tasksForDate(currentDate);
    if (form.isEdit && form.editId) {
      const updated = list.map((t) =>
        t.id === form.editId
          ? {
              ...t,
              name: form.name.trim(),
              durationMinutes: form.durationMinutes,
              startTime: form.startTime,
              endTime: form.endTime,
            }
          : t
      );
      setData((d) => ({ ...d, [currentDate]: updated }));
      setEditTask(null);
    } else {
      const newTask: Task = {
        id: String(Date.now()) + Math.random().toString(36).slice(2, 7),
        name: form.name.trim(),
        durationMinutes: form.durationMinutes,
        startTime: form.startTime,
        endTime: form.endTime,
        done: false,
      };
      setData((d) => ({
        ...d,
        [currentDate]: [...tasksForDate(currentDate), newTask],
      }));
      setStartTime(form.endTime);
    }

    // reset fields for next entry
    setName("");
    setDurHours(0);
    setDurMinutes(30);
    setPendingForm(null);
    setBedtimeModalOpen(false);
  }

  function addOrUpdateTask(e?: React.FormEvent<HTMLFormElement>) {
    if (e) e.preventDefault();
    setError("");
    const duration = Number(durHours) * 60 + Number(durMinutes);
    if (!name.trim()) return setError("Give the task a name.");
    if (!startTime) return setError("Pick a start time.");
    if (duration <= 0) return setError("Duration must be greater than 0.");
    const endTime = calcEndTimeFromStart(startTime, duration);
    if (!endTime)
      return setError(
        "Task would end past midnight. Pick a shorter duration or earlier start."
      );
    // If the task ends at or after 10:00 PM (bed time), show our custom modal
    const endMin = timeToMinutes(endTime) ?? 0;
    const BEDTIME_MIN = 22 * 60; // 10:00 PM
    if (endMin >= BEDTIME_MIN) {
      // store pending form and open modal
      setPendingForm({
        name,
        durationMinutes: duration,
        startTime,
        endTime,
        isEdit: Boolean(editTask),
        editId: editTask?.id ?? null,
      });
      setBedtimeModalOpen(true);
      return;
    }

    // commit immediately when not prompting
    commitTask({
      name,
      durationMinutes: duration,
      startTime,
      endTime,
      isEdit: Boolean(editTask),
      editId: editTask?.id ?? null,
    });
  }

  function handleModalConfirm() {
    if (pendingForm) commitTask(pendingForm);
  }

  function handleModalCancel() {
    setPendingForm(null);
    setBedtimeModalOpen(false);
  }

  function toggleDone(date: string, id: string) {
    setData((d) => ({
      ...d,
      [date]: d[date].map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    }));
  }

  function removeTask(date: string, id: string) {
    setData((d) => ({ ...d, [date]: d[date].filter((t) => t.id !== id) }));
  }

  function startEdit(task: Task) {
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
      if (start) window.clearTimeout(start);
      if (end) window.clearTimeout(end);
    });
    timersRef.current = {};
  }

  function requestNotificationPermission() {
    if (!("Notification" in window))
      return alert("This browser does not support notifications.");
    Notification.requestPermission().then((perm) =>
      setNotificationPerm(perm as NotificationPerm)
    );
  }

  function scheduleNotificationsForDate(date: string) {
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

      const startDelta = startDate.getTime() - now.getTime();
      const endDelta = endDate.getTime() - now.getTime();

      const timers = timersRef.current;
      const entry: { start?: number; end?: number } = {};
      if (startDelta > 0 && startDelta < 24 * 3600 * 1000) {
        entry.start = window.setTimeout(() => {
          new Notification(`Task starting: ${task.name}`, {
            body: `${formatTime12(task.startTime)} → ${formatTime12(
              task.endTime
            )}`,
          });
        }, startDelta);
      }
      if (endDelta > 0 && endDelta < 24 * 3600 * 1000) {
        entry.end = window.setTimeout(() => {
          new Notification(`Task ended: ${task.name}`, {
            body: `${formatTime12(task.startTime)} → ${formatTime12(
              task.endTime
            )}`,
          });
        }, endDelta);
      }
      if (entry.start || entry.end) timers[task.id] = entry;
    });
  }

  // ---------- history & analytics ----------
  function uniqueNames(): string[] {
    const all = Object.values(data).flat();
    const uniq = Array.from(new Set(all.map((t) => t.name))).sort();
    return uniq;
  }

  function buildChartData(): {
    date: string;
    scheduled: number;
    completed: number;
  }[] {
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
    const rows: string[] = [];
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
              String(t.durationMinutes),
              t.done ? "1" : "0",
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

  function importCSV(file?: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      const result = e.target?.result;
      if (typeof result !== "string") return;
      const text = result;
      const lines = text.split(/\n/).filter(Boolean);
      const out: DataMap = { ...data };
      // skip header if present
      const startAt = lines[0] && lines[0].startsWith("date,") ? 1 : 0;
      for (let i = startAt; i < lines.length; i++) {
        const [date, name_, start, end, durationStr, doneStr] =
          lines[i].split(",");
        if (!date) continue;
        if (!out[date]) out[date] = [];
        out[date].push({
          id: String(Date.now()) + Math.random().toString(36).slice(2, 7) + i,
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

  function resetDay(date: string) {
    if (!window.confirm("Clear all tasks for " + date + "?")) return;
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
    <div className="bg-gradient-to-b from-slate-50 to-white p-5 sm:px-10">
      <div className="max-w-6xl mx-auto">
        <header className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Daily Task Scheduler
            </h1>
            <p className="text-slate-500 mt-1">
              Plan, track, and review past days. Suggestions, charts, and
              notifications included.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={view}
              onChange={(e) => setView(e.target.value as "today" | "history")}
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
              className="rounded-md px-3 py-2 border text-sm"
            >
              Notify: {notificationPerm}
            </button>

            <div className="flex gap-2">
              <button
                onClick={exportCSV}
                className="px-3 py-2 rounded-md bg-sky-600 text-white text-sm"
              >
                Export CSV
              </button>

              <label className="px-3 py-2 rounded-md border cursor-pointer">
                Import
                <input
                  type="file"
                  accept="text/csv"
                  onChange={(e) => importCSV(e.target.files?.[0] ?? null)}
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
                <label className="text-sm text-slate-500">Task name</label>
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

              <div className="grid max-sm:grid-rows-3 sm:grid-cols-3 sm:gap-3">
                <div className="max-sm:h-[90px]">
                  <label className="text-sm text-slate-500">Hours</label>
                  <input
                    type="number"
                    min={0}
                    max={24}
                    value={durHours}
                    onChange={(e) => setDurHours(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
                <div className="max-sm:h-[90px]">
                  <label className="text-sm text-slate-500">Minutes</label>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={durMinutes}
                    onChange={(e) => setDurMinutes(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
                <div className="max-sm:h-[90px]">
                  <label className="text-sm text-slate-500">Start time</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    max="23:59"
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  />
                  <div className="mt-5 flex gap-2">
                    <button
                      type="button"
                      onClick={setStartToPreviousEnd}
                      className="text-xs px-2 py-1 rounded-md border hover:scale-105"
                    >
                      Use previous end
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStartTime("");
                      }}
                      className="text-xs px-2 py-1 rounded-md border hover:scale-105"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row max-sm:mt-5 sm:items-center gap-3 justify-between">
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

              <div className="mt-2 border-t pt-3 text-sm text-slate-500">
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

                <div className="mt-2">
                  <div className="text-sm text-slate-500 mb-2">
                    Tasks for the day — scroll this list if it gets long
                  </div>
                  <div className="max-h-[48vh] overflow-auto pr-5">
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
                                {formatTime12(t.startTime)} →{" "}
                                {formatTime12(t.endTime)} •{" "}
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
                  </div>
                </div>

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
                    <Bar
                      dataKey="scheduled"
                      name="Scheduled (h)"
                      fill="var(--chart-scheduled)"
                    />
                    <Bar
                      dataKey="completed"
                      name="Completed (h)"
                      fill="var(--chart-completed)"
                    />
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
                              <td className="px-2 py-2">
                                {formatTime12(t.startTime)}
                              </td>
                              <td className="px-2 py-2">
                                {formatTime12(t.endTime)}
                              </td>
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
          work while the page is open and has permission.
        </footer>
        {bedtimeModalOpen && pendingForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={handleModalCancel}
            />
            <div className="relative card p-6 rounded-lg w-full max-w-md z-10">
              <h3 className="text-lg font-medium mb-2">Bedtime warning</h3>
              <p className="text-sm text-slate-500 mb-4">
                This task ends at or after 10:00 PM (your bedtime). Do you want
                to continue and save it?
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={handleModalCancel}
                  className="px-3 py-2 rounded-md border"
                >
                  No
                </button>
                <button
                  onClick={handleModalConfirm}
                  className="px-3 py-2 rounded-md bg-sky-600 text-white"
                >
                  Yes
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
