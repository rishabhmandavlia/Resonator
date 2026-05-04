import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { KokoroStudio } from "./KokoroStudio";
import { Projects } from "./Projects";
import { RemoteStorage } from "./RemoteStorage";
import { SettingsPage } from "./SettingsPage";
import { Alert, AlertDescription } from "./ui/alert";
import { useAuth } from "../services/auth";

export function Layout() {
  const [currentPage, setCurrentPage] = useState("studio");
  const { activeAccount, hasValidActiveAccount, isAuthenticated } = useAuth();

  const renderContent = () => {
    switch (currentPage) {
      case "studio":
        return <KokoroStudio forceStandalone />;
      case "projects":
        return <Projects />;
      case "library":
        return <RemoteStorage />;
      case "settings":
        return <SettingsPage />;
      default:
        return <KokoroStudio forceStandalone />;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div className="flex-shrink-0">
        <Sidebar currentPage={currentPage} onPageChange={setCurrentPage} />
      </div>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {isAuthenticated && !hasValidActiveAccount && activeAccount && (
          <div className="mx-6 mt-6">
            <Alert className="border-amber-200 bg-amber-50 text-amber-950">
              <AlertDescription>
                The active account needs to be reconnected. Switch to another
                account or add this one again from the profile menu.
              </AlertDescription>
            </Alert>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-hidden">{renderContent()}</div>
      </main>
    </div>
  );
}
