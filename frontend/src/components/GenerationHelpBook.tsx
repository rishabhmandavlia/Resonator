import { BookOpen, MessageSquareQuote, Mic2, PauseCircle } from "lucide-react";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

const punctuationTips = [
  {
    mark: ".",
    label: "Full stop",
    effect: "Natural sentence ending with a medium pause.",
  },
  {
    mark: ",",
    label: "Comma",
    effect: "Short conversational breath that smooths delivery.",
  },
  {
    mark: "?",
    label: "Question",
    effect: "Lifts the ending so the line sounds curious or doubtful.",
  },
  {
    mark: "!",
    label: "Emphasis",
    effect: "Adds urgency, energy, or excitement.",
  },
  {
    mark: "...",
    label: "Ellipsis",
    effect: "Creates hesitation, suspense, or an emotional pause.",
  },
  {
    mark: ":",
    label: "Setup",
    effect: "Introduces an explanation or announcement-like phrase.",
  },
  {
    mark: ";",
    label: "Long split",
    effect: "Separates ideas more than a comma but less than a period.",
  },
  {
    mark: "- / —",
    label: "Interruption",
    effect: "Feels connected, interrupted, or more cinematic.",
  },
] as const;

const rhythmExamples = [
  {
    label: "Fast",
    sample: "I need to go right now before they arrive.",
  },
  {
    label: "Slow cinematic",
    sample: "I need to go.\n\nRight now.\n\nBefore they arrive.",
  },
  {
    label: "Suspense",
    sample: "I opened the door...\n\nAnd nobody was there.",
  },
] as const;

const styleRecipes = [
  {
    name: "Calm",
    cue: "Use soft wording and steady full stops.",
    sample: "It's okay.\nWe're safe now.",
  },
  {
    name: "Urgent",
    cue: "Short bursts create pressure.",
    sample: "Run!\nMove!\nGo now!",
  },
  {
    name: "Horror",
    cue: "Leave space for silence and dread.",
    sample: "Something was wrong.\n\nThen...\n\nthe lights turned on.",
  },
  {
    name: "Trailer",
    cue: "Use bold fragments and dramatic pauses.",
    sample: "In a world...\nwhere nothing survives...\none voice remains.",
  },
  {
    name: "Natural conversation",
    cue: "Contractions and smaller pauses sound human.",
    sample: "Yeah, I know what you mean.\nI was thinking about that too.",
  },
  {
    name: "YouTube narration",
    cue: "Clean sentences with light energy usually work best.",
    sample:
      "Today we're testing how different writing styles change the realism of AI voices.",
  },
] as const;

type GenerationHelpBookProps = {
  triggerLabel?: string;
  triggerVariant?: React.ComponentProps<typeof Button>["variant"];
  triggerSize?: React.ComponentProps<typeof Button>["size"];
  triggerClassName?: string;
};

export function GenerationHelpBook({
  triggerLabel = "Writing guide",
  triggerVariant = "outline",
  triggerSize = "sm",
  triggerClassName,
}: GenerationHelpBookProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant={triggerVariant}
          size={triggerSize}
          className={triggerClassName}
        >
          <BookOpen className="h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent className="h-[90vh] w-[94vw] max-w-[94vw] overflow-hidden border-border/60 bg-white p-0 sm:w-[92vw] sm:max-w-[92vw] lg:w-[90vw] lg:max-w-[90vw] sm:rounded-2xl">
        <div className="h-full max-h-full overflow-y-auto px-5 py-5 sm:px-7 lg:px-8">
          <DialogHeader className="border-b border-border/60 pb-5 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="bg-secondary/70">
                Voice Writing Guide
              </Badge>
              <Badge variant="outline">Use while generating</Badge>
            </div>
            <DialogTitle className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
              Shape pauses, pacing, and emotion with writing.
            </DialogTitle>
            <DialogDescription className="max-w-3xl text-sm leading-6 text-muted-foreground">
              Small text changes can make the same voice sound calmer,
              sharper, slower, more dramatic, or more natural. Use this guide
              as a quick scriptwriting cheat sheet while you work.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-6">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="min-w-0 overflow-hidden border-border/60 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="min-w-0 text-base leading-snug">
                    <span className="flex min-w-0 items-start gap-2">
                    <PauseCircle className="h-4 w-4 text-primary" />
                    <span className="min-w-0 break-words">
                      Punctuation changes pauses
                    </span>
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="min-w-0 break-words text-sm leading-6 text-muted-foreground">
                  Periods, commas, ellipses, and dashes are the fastest way to
                  control breath size and timing.
                </CardContent>
              </Card>

              <Card className="min-w-0 overflow-hidden border-border/60 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="min-w-0 text-base leading-snug">
                    <span className="flex min-w-0 items-start gap-2">
                    <Mic2 className="h-4 w-4 text-primary" />
                    <span className="min-w-0 break-words">Layout changes rhythm</span>
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="min-w-0 break-words text-sm leading-6 text-muted-foreground">
                  Line breaks and short paragraphs create larger pauses than a
                  normal sentence flow.
                </CardContent>
              </Card>

              <Card className="min-w-0 overflow-hidden border-border/60 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="min-w-0 text-base leading-snug">
                    <span className="flex min-w-0 items-start gap-2">
                    <MessageSquareQuote className="h-4 w-4 text-primary" />
                    <span className="min-w-0 break-words">Wording changes tone</span>
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="min-w-0 break-words text-sm leading-6 text-muted-foreground">
                  Softer words feel warm and intimate. Sharper words feel urgent,
                  aggressive, or intense.
                </CardContent>
              </Card>
            </div>

            <Card className="min-w-0 overflow-hidden border-border/60 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Punctuation quick guide</CardTitle>
                <CardDescription>
                  Use punctuation intentionally. Overdoing symbols usually hurts
                  clarity.
                </CardDescription>
              </CardHeader>
              <CardContent className="min-w-0">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {punctuationTips.map((tip) => (
                    <div
                      key={`${tip.mark}-${tip.label}`}
                      className="min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-secondary/10 p-4"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="rounded-md bg-white px-2 py-1 font-mono text-sm font-semibold text-foreground shadow-sm">
                          {tip.mark}
                        </span>
                        <p className="min-w-0 break-words text-sm font-semibold text-foreground">
                          {tip.label}
                        </p>
                      </div>
                      <p className="mt-3 break-words text-sm leading-6 text-muted-foreground">
                        {tip.effect}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <Card className="min-w-0 overflow-hidden border-border/60 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg">Rhythm by structure</CardTitle>
                  <CardDescription>
                    The same idea sounds different depending on where you break
                    the lines.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid min-w-0 gap-4 md:grid-cols-3">
                  {rhythmExamples.map((example) => (
                    <div
                      key={example.label}
                      className="min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-slate-950 p-4 text-slate-50"
                    >
                      <p className="break-words text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">
                        {example.label}
                      </p>
                      <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6 text-slate-100 [overflow-wrap:anywhere]">
                        {example.sample}
                      </pre>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="min-w-0 overflow-hidden border-border/60 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg">Quick emphasis rules</CardTitle>
                </CardHeader>
                <CardContent className="min-w-0">
                  <ul className="space-y-3 text-sm leading-6 text-muted-foreground">
                    <li>
                      <span className="font-semibold text-foreground">
                        ALL CAPS
                      </span>{" "}
                      adds strong emphasis. Use it sparingly.
                    </li>
                    <li>
                      <span className="font-semibold text-foreground">
                        Dialogue quotes
                      </span>{" "}
                      often sound more natural than flat narration.
                    </li>
                    <li>
                      <span className="font-semibold text-foreground">
                        Casual words
                      </span>{" "}
                      like "yeah", "gonna", or "kinda" can make delivery feel less robotic.
                    </li>
                    <li>
                      <span className="font-semibold text-foreground">
                        Repeated letters
                      </span>{" "}
                      can stretch pronunciation, but too much can sound broken.
                    </li>
                    <li>
                      <span className="font-semibold text-foreground">
                        Blank lines
                      </span>{" "}
                      create larger breathing space than commas or periods.
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </div>

            <Card className="min-w-0 overflow-hidden border-border/60 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Quick style recipes</CardTitle>
                <CardDescription>
                  Start with one of these patterns, then rewrite until the voice
                  lands in the tone you want.
                </CardDescription>
              </CardHeader>
              <CardContent className="min-w-0">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {styleRecipes.map((recipe) => (
                    <div
                      key={recipe.name}
                      className="min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-white p-4 shadow-sm"
                    >
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <p className="min-w-0 break-words text-base font-semibold text-foreground">
                          {recipe.name}
                        </p>
                        <Badge variant="outline">Template</Badge>
                      </div>
                      <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">
                        {recipe.cue}
                      </p>
                      <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-secondary/20 p-3 font-sans text-sm leading-6 text-foreground [overflow-wrap:anywhere]">
                        {recipe.sample}
                      </pre>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0 overflow-hidden border-amber-200 bg-amber-50/70 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg text-amber-950">
                  Stability tips
                </CardTitle>
                <CardDescription className="text-amber-900/85">
                  Good punctuation improves timing, pauses, and clarity. Too many
                  symbols usually make the output less reliable.
                </CardDescription>
              </CardHeader>
              <CardContent className="min-w-0">
                <ul className="space-y-2 text-sm leading-6 text-amber-950">
                  <li>Avoid giant unbroken sentences.</li>
                  <li>Do not stack too many symbols like !!!!! or ............</li>
                  <li>Use ellipses for hesitation, not on every line.</li>
                  <li>Rewrite for rhythm, not just grammar.</li>
                  <li>Think like a scriptwriter: pace, breath, then wording.</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}