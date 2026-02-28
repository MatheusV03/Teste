import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("gym.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_number INTEGER,
    exercise_name TEXT,
    sets TEXT,
    reps TEXT
  );

  CREATE TABLE IF NOT EXISTS trained_days (
    date TEXT PRIMARY KEY,
    planned_day INTEGER,
    completed INTEGER DEFAULT 0,
    rescheduled INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS diets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meal_name TEXT,
    items TEXT,
    total_protein TEXT
  );

  CREATE TABLE IF NOT EXISTS reschedule_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_date TEXT,
    new_date TEXT,
    workout_day INTEGER
  );
`);

// Seed initial data if empty
const workoutCount = db.prepare("SELECT COUNT(*) as count FROM workouts").get() as any;
if (workoutCount.count === 0) {
  const initialWorkouts = [
    // Dia 1
    [1, "Supino", "3", "10–12"], [1, "Supino Inclinado", "3", "10–12"], [1, "Fly", "3", "10–12"],
    [1, "Tríceps Corda", "3", "10–12"], [1, "Tríceps Francês", "3", "10–12"], [1, "Tríceps Testa", "3", "10–12"],
    // Dia 2
    [2, "Remada Curvada", "3", "10–12"], [2, "Remada Aberta", "3", "10–12"], [2, "Puxada Aberta", "3", "10–12"],
    [2, "Rosca Scott", "3", "10–12"], [2, "Rosca Martelo", "3", "10–12"], [2, "Rosca Direta", "3", "10–12"],
    // Dia 3
    [3, "Agachamento Hack", "3", "10–12"], [3, "Cadeira Extensora", "3", "10–12"], [3, "Adutora", "3", "10–12"],
    [3, "Mesa Flexora", "3", "10–12"], [3, "Cadeira Flexora", "3", "10–12"], [3, "Leg Press", "3", "10–12"],
    // Dia 4
    [4, "Crucifixo Inverso", "3", "10–12"], [4, "Elevação Frontal", "3", "10–12"], [4, "Elevação Lateral", "3", "10–12"], [4, "Desenvolvimento", "3", "10–12"],
    // Dia 5
    [5, "Tríceps Corda", "3", "10–12"], [5, "Tríceps Francês", "3", "10–12"], [5, "Tríceps Testa", "3", "10–12"],
    [5, "Rosca Direta", "3", "10–12"], [5, "Rosca Martelo", "3", "10–12"], [5, "Rosca Scott", "3", "10–12"]
  ];
  const insertWorkout = db.prepare("INSERT INTO workouts (day_number, exercise_name, sets, reps) VALUES (?, ?, ?, ?)");
  initialWorkouts.forEach(w => insertWorkout.run(w));

  const initialDiets = [
    ["Café da Manhã", "3 ovos inteiros, 1 fatia de pão integral, 1 colher de manteiga de amendoim", "31g"],
    ["Lanche da Manhã", "1 iogurte natural (170g), 1 scoop de whey (30g)", "30g"],
    ["Almoço", "120g de frango grelhado, 4 colheres de arroz, 1 colher de feijão, salada verde e legumes", "41g"],
    ["Lanche da Tarde", "2 ovos cozidos, 1 fatia média de batata-doce, café preto sem açúcar", "28g"],
    ["Jantar", "120g de frango grelhado, 4 colheres de arroz, 1 colher de feijão, salada verde e legumes", "41g"]
  ];
  const insertDiet = db.prepare("INSERT INTO diets (meal_name, items, total_protein) VALUES (?, ?, ?)");
  initialDiets.forEach(d => insertDiet.run(d));
}

async function startServer() {
  const app = express();
  app.use(express.json());
  const PORT = 3000;

  // Helper to get current workout day
  const getNextWorkoutDay = () => {
    const lastTrained = db.prepare("SELECT planned_day FROM trained_days WHERE completed = 1 ORDER BY date DESC LIMIT 1").get() as any;
    if (!lastTrained) return 1;
    return (lastTrained.planned_day % 5) + 1;
  };

  // API Routes
  app.get("/api/status", (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    
    // Check for missed days before today
    const lastEntry = db.prepare("SELECT * FROM trained_days ORDER BY date DESC LIMIT 1").get() as any;
    
    if (lastEntry && lastEntry.date < today) {
      // If the last entry was not completed, mark it as rescheduled
      // and we need to fill the gap if any
      let currentDate = new Date(lastEntry.date);
      currentDate.setDate(currentDate.getDate() + 1);
      const todayDate = new Date(today);

      while (currentDate < todayDate) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const existing = db.prepare("SELECT * FROM trained_days WHERE date = ?").get(dateStr);
        if (!existing) {
          // If we missed a day, the workout shifts
          db.prepare("INSERT INTO trained_days (date, planned_day, completed, rescheduled) VALUES (?, ?, 0, 1)")
            .run(dateStr, getNextWorkoutDay());
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    let status = db.prepare("SELECT * FROM trained_days WHERE date = ?").get(today) as any;
    
    if (!status) {
      const plannedDay = getNextWorkoutDay();
      db.prepare("INSERT INTO trained_days (date, planned_day) VALUES (?, ?)").run(today, plannedDay);
      status = { date: today, planned_day: plannedDay, completed: 0, rescheduled: 0 };
    }

    const workouts = db.prepare("SELECT * FROM workouts WHERE day_number = ?").all(status.planned_day);
    const diet = db.prepare("SELECT * FROM diets").all();

    res.json({ status, workouts, diet });
  });

  app.post("/api/complete", (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    db.prepare("UPDATE trained_days SET completed = 1 WHERE date = ?").run(today);
    res.json({ success: true });
  });

  app.get("/api/calendar", (req, res) => {
    const history = db.prepare("SELECT * FROM trained_days ORDER BY date ASC").all();
    res.json(history);
  });

  app.get("/api/workouts", (req, res) => {
    const allWorkouts = db.prepare("SELECT * FROM workouts ORDER BY day_number ASC").all();
    const grouped = allWorkouts.reduce((acc: any, curr: any) => {
      if (!acc[curr.day_number]) acc[curr.day_number] = [];
      acc[curr.day_number].push(curr);
      return acc;
    }, {});
    res.json(grouped);
  });

  app.get("/api/stats", (req, res) => {
    const totalCompleted = db.prepare("SELECT COUNT(*) as count FROM trained_days WHERE completed = 1").get() as any;
    const totalRescheduled = db.prepare("SELECT COUNT(*) as count FROM trained_days WHERE rescheduled = 1").get() as any;
    const weeklyConsistency = db.prepare(`
      SELECT 
        strftime('%w', date) as day_of_week,
        COUNT(*) as count 
      FROM trained_days 
      WHERE completed = 1 
      GROUP BY day_of_week
    `).all();

    res.json({
      totalCompleted: totalCompleted.count,
      totalRescheduled: totalRescheduled.count,
      weeklyConsistency
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
