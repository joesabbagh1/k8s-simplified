import { Accordion, AccordionHeader, AccordionItem, AccordionPanel, AccordionTrigger } from "@ui-sdk/react/accordion"
import { type CSSProperties, useState } from "react"
import { layerStyle } from "../data/layers"
import { lessonById } from "../data/lessons"
import { timeline } from "../playback"
import { lessonPath } from "../route"
import { Fields, Frame } from "./Decoder"
import { Icon } from "./Icon"
import { Link } from "./Link"

/** Each question, its answer, and the lesson event that shows it. */
const QUESTIONS: { question: string; answer: string; lesson: string; event: string }[] = [
  {
    question: "What does a packet between two nodes look like?",
    answer: "One ordinary UDP packet. flannel wraps the Pod's own packet in 50 bytes of outer headers.",
    lesson: "pod-to-pod-across-nodes", event: "ax8",
  },
  {
    question: "Where does exit code 137 come from?",
    answer: "128 plus 9, the number of SIGKILL. The kernel killed the app for passing its memory limit.",
    lesson: "oom-killed", event: "om5",
  },
  {
    question: "Why is my Pod stuck in Pending?",
    answer: "No node fits it. The scheduler writes the reason into the Pod's status and leaves it unplaced.",
    lesson: "the-scheduler", event: "sd7",
  },
  {
    question: "Which Pod does a Service pick?",
    answer: "A random one, once per connection. With three Pods, each iptables rule wins a third of the time.",
    lesson: "pod-calls-service", event: "sv7",
  },
  {
    question: "Why does a Pod that's shutting down still get requests?",
    answer: "It has left the Service's endpoints, but the rules on each node haven't been rewritten yet.",
    lesson: "graceful-shutdown", event: "gs3",
  },
  {
    question: "How long does Kubernetes wait for a dead node?",
    answer: "Forty seconds of silence before it's NotReady, then five minutes before its Pods are evicted.",
    lesson: "node-goes-dark", event: "dk5",
  },
  {
    question: "Why does my app still see the old config?",
    answer: "Environment variables are set when the process starts. Nothing reads the ConfigMap again after that.",
    lesson: "configmaps-secrets", event: "cf3",
  },
  {
    question: "What stops a Pod from reading Secrets?",
    answer: "RBAC only grants. No rule gives this Pod's ServiceAccount access to Secrets, so it gets a 403.",
    lesson: "rbac-tokens", event: "rb12",
  },
]

const ANSWERS = QUESTIONS.map(({ question, answer, ...at }) => {
  const lesson = lessonById(at.lesson)!
  const event = timeline(lesson).events.find((e) => e.id === at.event)!
  return { question, answer, lesson, event }
})

export function Questions() {
  const [open, setOpen] = useState([ANSWERS[0].event.id])
  return (
    <Accordion className="questions" aria-label="Questions" value={open} onValueChange={setOpen} collapsible={false} style={{ "--n": ANSWERS.length } as CSSProperties}>
      {ANSWERS.map(({ question, answer, lesson, event }) => (
        <AccordionItem key={event.id} value={event.id} className="question">
          <AccordionHeader className="question-head">
            <AccordionTrigger className="question-trigger">
              {question}
              <Icon name="right" size={16} />
            </AccordionTrigger>
          </AccordionHeader>
          <AccordionPanel className="answer">
            <div className="answer-in" style={layerStyle(event)}>
              <p className="answer-says">{answer}</p>
              <p className="answer-route">
                {event.src === event.dst ? event.src : `${event.src} → ${event.dst}`}
              </p>
              <p className="answer-info">{event.info}</p>
              {event.frame ? (
                <Frame layers={event.frame} />
              ) : (
                <div className="answer-fields">
                  <Fields fields={event.decoded[0].fields} />
                </div>
              )}
              <Link className="answer-link" to={lessonPath(lesson.id, event.step + 1)}>
                Watch it in {lesson.title}, step {event.step + 1}
                <Icon name="right" size={13} />
              </Link>
            </div>
          </AccordionPanel>
        </AccordionItem>
      ))}
    </Accordion>
  )
}
