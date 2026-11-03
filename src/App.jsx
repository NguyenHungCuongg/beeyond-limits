import { useEffect, useRef, useState } from "react";
import Home from "./pages/Home";
import Pomodoro from "./pages/Pomodoro";
import TaskList from "./pages/TaskList";
import WebsiteBlocker from "./pages/WebsiteBlocker";
import AmbientSounds from "./pages/AmbientSounds";
import FocusSessionSetup from "./pages/FocusSessionSetup";
import ActiveFocusSession from "./pages/ActiveFocusSession";
import FocusSessionComplete from "./pages/FocusSessionComplete";
import AlarmPopup from "./pages/AlarmPopup";
import SavedSessions from "./pages/SavedSessions";
import FocusStats from "./pages/FocusStats";
import { useFocusSession } from "./hooks/useFocusSession";
import { Toaster } from "react-hot-toast";

function App() {
  const initialView = new URLSearchParams(globalThis.location?.search || "").get("view");
  const [currentPage, setCurrentPage] = useState(
    ["alarm", "focus-complete"].includes(initialView) ? initialView : "home",
  );
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const hasRoutedInitialState = useRef(false);
  const focusSession = useFocusSession();

  useEffect(() => {
    if (focusSession.isLoading || hasRoutedInitialState.current) return;
    hasRoutedInitialState.current = true;

    const status = focusSession.activeSession?.status;
    if (
      focusSession.pendingAlarm &&
      ["focus_completed", "break_completed"].includes(status)
    ) {
      setCurrentPage("alarm");
    } else if (
      ["active_focus", "paused_focus", "active_break", "paused_break"].includes(status)
    ) {
      setCurrentPage("focus-active");
    }
  }, [focusSession.isLoading, focusSession.pendingAlarm, focusSession.activeSession]);

  const navigateTo = (page) => {
    setCurrentPage(page);
  };

  const openSetup = (template = null) => {
    setSelectedTemplate(template);
    setCurrentPage("focus-setup");
  };

  const renderPage = () => {
    switch (currentPage) {
      case "home":
        return (
          <Home
            onNavigate={navigateTo}
            onStartFocus={openSetup}
            focusSession={focusSession}
          />
        );
      case "focus-setup":
        return (
          <FocusSessionSetup
            onNavigate={navigateTo}
            focusSession={focusSession}
            template={selectedTemplate}
          />
        );
      case "focus-active":
        return (
          <ActiveFocusSession
            onNavigate={navigateTo}
            onStartFocus={() => openSetup()}
            focusSession={focusSession}
          />
        );
      case "alarm":
        return (
          <AlarmPopup
            onNavigate={navigateTo}
            focusSession={focusSession}
          />
        );      case "focus-complete":
        return (
          <FocusSessionComplete
            onNavigate={navigateTo}
            focusSession={focusSession}
          />
        );
      case "saved-sessions":
        return (
          <SavedSessions
            onNavigate={navigateTo}
            focusSession={focusSession}
            onSelectTemplate={setSelectedTemplate}
          />
        );
      case "stats":
        return <FocusStats onNavigate={navigateTo} focusSession={focusSession} />;
      case "pomodoro":
        return <Pomodoro onNavigate={navigateTo} />;
      case "tasklist":
        return <TaskList onNavigate={navigateTo} />;
      case "websiteblocker":
        return <WebsiteBlocker onNavigate={navigateTo} focusSession={focusSession} />;
      case "ambientsounds":
        return <AmbientSounds onNavigate={navigateTo} />;
      default:
        return <Home onNavigate={navigateTo} />;
    }
  };

  return (
    <div className="w-[400px] min-h-[600px] bg-canvas overflow-hidden">
      {/* Content area */}
      {renderPage()}
      <Toaster
        toastOptions={{
          style: {
            background: "#ffffff",
            color: "#000000",
            border: "3px solid #000000",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.875rem",
            boxShadow: "4px 4px 0px 0px #000000",
            borderRadius: "0",
          },
          success: {
            iconTheme: { primary: "#000000", secondary: "#ffffff" },
          },
          error: {
            iconTheme: { primary: "#000000", secondary: "#ffffff" },
          },
        }}
      />
    </div>
  );
}

export default App;
