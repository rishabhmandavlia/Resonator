import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Progress } from "./ui/progress";
import {
  Database,
  Folder,
  FileAudio,
  UploadCloud,
  Trash2,
  Download,
  Cloud,
} from "lucide-react";
import { Input } from "./ui/input";

export function RemoteStorage() {
  const files = [
    {
      id: "f1",
      name: "Welcome_Intro_Final.wav",
      size: "2.4 MB",
      type: "audio/wav",
      date: "Oct 12, 2024",
    },
    {
      id: "f2",
      name: "Lesson_1_Physics.mp3",
      size: "15.1 MB",
      type: "audio/mp3",
      date: "Oct 10, 2024",
    },
    {
      id: "f3",
      name: "Customer_Service_Prompt.wav",
      size: "1.2 MB",
      type: "audio/wav",
      date: "Oct 9, 2024",
    },
    {
      id: "f4",
      name: "Podcast_Episode_3_Intro.mp3",
      size: "4.5 MB",
      type: "audio/mp3",
      date: "Oct 5, 2024",
    },
    {
      id: "f5",
      name: "Voiceover_Demo.wav",
      size: "8.7 MB",
      type: "audio/wav",
      date: "Sep 28, 2024",
    },
  ];

  return (
    <div className="h-full p-6">
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-border/50 bg-white shadow-sm">
        <div className="flex-1 overflow-y-auto p-6 md:p-8 lg:p-10 space-y-8">
          {/* Header Section */}
          <div className="flex flex-col space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-semibold text-foreground tracking-tight">
                  Remote Storage
                </h1>
                <p className="text-muted-foreground mt-2 text-lg">
                  Manage your generated audio files and cloud storage capacity.
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="gap-2 h-11 px-6 border-border/50 hover:bg-secondary/50"
                >
                  <Cloud className="w-5 h-5" />
                  Sync Now
                </Button>
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2 h-11 px-6">
                  <UploadCloud className="w-5 h-5" />
                  Upload File
                </Button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Storage Capacity */}
            <div className="lg:col-span-1 space-y-6">
              <Card className="border-border/50 shadow-sm bg-secondary/10">
                <CardContent className="p-6 space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                      <Database className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground text-lg">
                        Storage
                      </h3>
                      <p className="text-sm text-muted-foreground">Pro Plan</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between text-sm font-medium">
                      <span>45.5 GB Used</span>
                      <span className="text-muted-foreground">
                        100 GB Total
                      </span>
                    </div>
                    <Progress value={45.5} className="h-2 bg-secondary" />
                  </div>

                  <div className="space-y-4 pt-4 border-t border-border/50">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <FileAudio className="w-4 h-4 text-blue-500" />
                        Audio Files
                      </div>
                      <span className="font-medium">42.1 GB</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Folder className="w-4 h-4 text-orange-500" />
                        Projects Data
                      </div>
                      <span className="font-medium">3.4 GB</span>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    className="w-full border-primary/20 text-primary hover:bg-primary/10 hover:text-primary mt-4"
                  >
                    Upgrade Storage
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* File Explorer */}
            <div className="lg:col-span-3 space-y-6">
              <div className="flex items-center justify-between bg-secondary/30 p-4 rounded-xl border border-border/50">
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="bg-white shadow-sm border border-border/50 text-foreground font-medium px-4"
                  >
                    All Files
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:bg-white/50 px-4"
                  >
                    Recent
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:bg-white/50 px-4"
                  >
                    Favorites
                  </Button>
                </div>
                <Input
                  placeholder="Search files..."
                  className="w-64 bg-white border-border/50"
                />
              </div>

              <div className="bg-white rounded-xl border border-border/50 shadow-sm overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-secondary/30 text-muted-foreground uppercase text-xs font-semibold tracking-wider border-b border-border/50">
                    <tr>
                      <th className="px-6 py-4">Name</th>
                      <th className="px-6 py-4">Size</th>
                      <th className="px-6 py-4">Type</th>
                      <th className="px-6 py-4">Modified</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {files.map((file) => (
                      <tr
                        key={file.id}
                        className="hover:bg-secondary/20 transition-colors group"
                      >
                        <td className="px-6 py-4 font-medium text-foreground flex items-center gap-3">
                          <FileAudio className="w-5 h-5 text-muted-foreground/70" />
                          {file.name}
                        </td>
                        <td className="px-6 py-4 text-muted-foreground">
                          {file.size}
                        </td>
                        <td className="px-6 py-4">
                          <Badge
                            variant="outline"
                            className="bg-secondary/50 font-normal text-xs uppercase tracking-wider text-muted-foreground"
                          >
                            {file.type.split("/")[1]}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 text-muted-foreground">
                          {file.date}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-primary"
                            >
                              <Download className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-red-500"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
