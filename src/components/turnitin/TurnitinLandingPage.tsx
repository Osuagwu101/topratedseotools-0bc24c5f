import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronDown, CreditCard, FileDown, FileText, UploadCloud } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { TURNITIN_CREDIT_UNIT_PRICE_LABEL } from "@/lib/turnitin-pricing";

const steps = [
  {
    icon: CreditCard,
    title: "Buy a check",
    text: "Choose how many documents to check and pay online. Each document uses one credit.",
  },
  {
    icon: UploadCloud,
    title: "Upload your document",
    text: "Open Submit File and upload a PDF, DOC or DOCX. Choose your similarity report options before submitting.",
  },
  {
    icon: FileDown,
    title: "Download your reports",
    text: "Open Check History to follow the status and download your reports when they’re ready.",
  },
];

const questions = [
  {
    title: "What file types can I upload?",
    answer: "You can submit PDF, DOC and DOCX files. Upload one document per check.",
  },
  {
    title: "How long does a check take?",
    answer:
      "Reports usually arrive within minutes. Processing time can vary by document and service availability. You can follow your submission in Check History.",
  },
  {
    title: "Is my document added to Turnitin’s repository?",
    answer:
      "No. Documents checked through this service are not added to Turnitin’s repository. Your available reports are kept in your private account history.",
  },
  {
    title: "What reports do I receive?",
    answer:
      "The similarity report shows matched passages and their sources. An AI-writing report is also available for eligible documents.",
  },
  {
    title: "How long do prepaid checks last?",
    answer: "Each batch of prepaid checks is valid for seven days from the date of purchase.",
  },
];

export function TurnitinLandingPage() {
  return (
    <SiteLayout>
      <section className="border-b bg-gradient-hero" aria-labelledby="turnitin-heading">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-16 lg:px-8 lg:py-20">
          <div>
            <h1
              id="turnitin-heading"
              className="max-w-xl text-4xl font-bold tracking-tight sm:text-5xl"
            >
              Turnitin Checks in Nigeria and Ghana
            </h1>
            <p className="mt-4 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg">
              Check your document for similarity and AI writing. Pay online, upload your file, and
              download your reports from your account.
            </p>
            <div className="mt-6">
              <p className="text-lg font-semibold">
                <span className="text-2xl text-primary">{TURNITIN_CREDIT_UNIT_PRICE_LABEL}</span>{" "}
                per check
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Turnitin checkout is billed in Nigerian naira.
              </p>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link
                to="/login"
                search={{ redirect: "/turnitin/buy" }}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-glow hover:opacity-90"
              >
                Buy a Turnitin Check <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                to="/login"
                search={{ redirect: "/turnitin" }}
                className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline-offset-4 hover:underline"
              >
                Sign in
              </Link>
            </div>
          </div>

          <figure className="rounded-2xl border bg-card p-5 shadow-card sm:p-6">
            <figcaption className="mb-5 flex items-center gap-3 border-b pb-4">
              <FileText className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <h2 className="font-semibold">Sample similarity report</h2>
                <p className="text-xs text-muted-foreground">
                  Illustrative example using fictional data
                </p>
              </div>
            </figcaption>
            <p className="text-sm font-medium">Overall similarity</p>
            <p className="mt-1 text-3xl font-bold text-primary">18%</p>
            <div className="mt-4 rounded-lg bg-muted/60 px-4 py-3 text-sm leading-6">
              <p className="font-medium">Example matched passage</p>
              <p className="mt-1 text-muted-foreground">
                Shaded streets{" "}
                <mark className="rounded bg-primary/15 px-0.5 text-foreground">
                  can help reduce heat in urban areas
                </mark>{" "}
                during the day.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Example source • Urban Shade Study
              </p>
            </div>
          </figure>
        </div>
      </section>

      <section
        className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8"
        aria-labelledby="turnitin-steps-heading"
      >
        <h2 id="turnitin-steps-heading" className="text-2xl font-bold tracking-tight">
          How it works
        </h2>
        <ol className="mt-5 grid gap-4 md:grid-cols-3">
          {steps.map(({ icon: Icon, title, text }, index) => (
            <li key={title} className="rounded-xl border bg-card p-5">
              <Icon className="mb-3 h-5 w-5 text-primary" aria-hidden="true" />
              <h3 className="font-semibold">
                {index + 1}. {title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t bg-muted/30" aria-labelledby="turnitin-faq-heading">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
          <h2 id="turnitin-faq-heading" className="text-2xl font-bold tracking-tight">
            Frequently asked questions
          </h2>
          <div className="mt-5 divide-y rounded-xl border bg-card">
            {questions.map(({ title, answer }) => (
              <details key={title} className="group px-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                  {title}
                  <ChevronDown
                    className="h-4 w-4 shrink-0 text-muted-foreground transition group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <p className="pb-4 text-sm leading-6 text-muted-foreground">{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
