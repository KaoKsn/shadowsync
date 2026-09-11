/**
 * PrivSight — Agent Session Execution Loop (script.js)
 *
 * Demonstrates the conceptual agent execution loop:
 *  1. Create session with unique UUID
 *  2. Persist in localStorage under "agentSessions"
 *  3. Loop through backend action triggers
 *  4. Update session actions and status in localStorage
 *  5. Mark session completed upon completion
 */

async function session(task) {
  // 1. Create and store session in localStorage
  const activeSession = AgentSessionManager.createSession(task);
  const id = activeSession.id;

  try {
    let stepIndex = 0;
    let isFinished = false;

    // 2. Execution loop
    while (!isFinished) {
      // Trigger agent action / call backend placeholder
      const agentAction = await AgentSessionManager.fetchAgentAction(activeSession, stepIndex);

      // Store/update agent action in the session and update localStorage
      AgentSessionManager.appendActionToSession(id, {
        stepIndex,
        action: agentAction.action,
        status: agentAction.status,
        description: agentAction.description,
      });

      // Update session status in localStorage
      AgentSessionManager.updateSession(id, {
        status: agentAction.status,
      });

      isFinished = agentAction.isFinished;
      stepIndex++;

      // Pause for step duration (if simulating)
      if (!isFinished && agentAction.duration) {
        await new Promise((resolve) => setTimeout(resolve, agentAction.duration));
      }
    }

    // 3. Mark session as completed
    AgentSessionManager.updateSession(id, {
      status: AgentSessionManager.SessionStatus.COMPLETED,
    });

    console.log(`[PrivSight Session] Session ${id} completed successfully.`);
    return AgentSessionManager.getSession(id);
  } catch (err) {
    // 4. Mark session as failed on unhandled error
    AgentSessionManager.updateSession(id, {
      status: AgentSessionManager.SessionStatus.FAILED,
      error: err.message,
    });
    console.error(`[PrivSight Session] Session ${id} failed:`, err);
    throw err;
  }
}