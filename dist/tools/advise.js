export function createAdviseTool(collectedNotes) {
    return {
        name: "advise",
        description: "Submit a concrete advisory note to the session. Only use when there is an actionable flaw, bug, or risk.",
        parameters: {
            type: "object",
            properties: {
                note: {
                    type: "string",
                    description: "One concrete, terse, and actionable piece of advice.",
                },
                severity: {
                    type: "string",
                    description: "Severity level: 'nit' (style/minor), 'concern' (material risk), or 'blocker' (severe flaw/circular work).",
                },
            },
            required: ["note"],
        },
        async execute(args) {
            const note = String(args["note"] || "").trim();
            if (!note)
                return "Error: note cannot be empty";
            let rawSeverity = String(args["severity"] || "nit").toLowerCase();
            if (rawSeverity !== "nit" && rawSeverity !== "concern" && rawSeverity !== "blocker") {
                rawSeverity = "nit";
            }
            collectedNotes.push({
                note,
                severity: rawSeverity,
            });
            return `Recorded advisory note (${rawSeverity}).`;
        },
    };
}
//# sourceMappingURL=advise.js.map