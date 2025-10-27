import { Route, Routes } from "react-router-dom";
import DailyTaskPlannerV2 from "./components/DailyTask.jsx";

function App() {
  return (
    <Routes>
      <Route path="/" element={<DailyTaskPlannerV2 />} />
    </Routes>
  );
}

export default App;
