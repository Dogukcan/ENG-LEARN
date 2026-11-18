// Conversation scenarios. Titles are Turkish (shown to the learner); tasks and the end
// condition are English because they are pasted into the prompt for the AI as-is.
export interface Scenario {
  id: string;
  title: string;
  /** Short Turkish label for the kind of talk, shown under the title on the card. */
  kind: string;
  tasks: readonly [string, string, string];
  endCondition: string;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "retell-reading",
    title: "Bugün okuduğunu anlat",
    kind: "Anlatma",
    tasks: [
      "Summarize what you read today in at least four sentences.",
      "Explain one idea from the text that surprised you and why.",
      "Say whether you agree with the author and give one reason.",
    ],
    endCondition: "The session ends when all three tasks are done.",
  },
  {
    id: "cafe-order",
    title: "Kafede sipariş ver",
    kind: "Rol yapma",
    tasks: [
      "Order a drink and a snack, and ask one question about the menu.",
      "Politely change your order after the waiter mentions something is unavailable.",
      "Ask for the bill and split it with a friend.",
    ],
    endCondition: "The session ends when the bill is paid.",
  },
  {
    id: "defend-idea",
    title: "Bir fikri savun",
    kind: "Tartışma",
    tasks: [
      "State an opinion you hold and give two reasons for it.",
      "Respond to a counter-argument without just repeating yourself.",
      "Conclude with a one-sentence summary of your position.",
    ],
    endCondition: "The session ends when you have concluded your position.",
  },
  {
    id: "describe-picture",
    title: "Resmi betimle",
    kind: "Betimleme",
    tasks: [
      "Describe what you can see in the picture: people, objects, and place.",
      "Guess what happened just before the picture was taken.",
      "Imagine what will happen next and explain your guess.",
    ],
    endCondition: "The session ends when all three tasks are done.",
  },
];

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
