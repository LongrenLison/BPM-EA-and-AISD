package local.clinic;

import java.time.Instant;
import java.util.*;

/** Synthetic local correspondence only; never sends email or clinical content. */
public final class LetterLogic {
    public static final String ERROR_CODE = "CLINIC_LETTER_DISPATCH_REJECTED";
    public static final List<String> ACTIONS = List.of("record-draft-start", "dispatch", "reminder", "escalate-one-month", "escalate-three-months");
    private static final Set<String> RECIPIENTS = Set.of("PATIENT", "GP", "HEALTHCARE_PROVIDER", "OTHER_PROFESSIONAL");
    private static final List<String> CLINICAL_FIELDS = List.of("clinicalSummary", "diagnosis", "clinicalFindings", "treatmentDecisions", "followUpPlan", "communicationInstructions");
    public enum Action { COMPLETE, BUSINESS_ERROR, TECHNICAL_FAILURE }
    public record Result(Action action, Map<String, Object> variables, String message) {}

    public static Result handle(String action, Map<String, Object> v, Instant now) {
        if (!ACTIONS.contains(action)) throw new IllegalArgumentException("Unsupported task type");
        if (!(v.get("clinicLetterId") instanceof String id) || !id.matches("[A-Za-z0-9_-]{1,80}")) throw new IllegalArgumentException("Invalid synthetic letter identifier");
        for (String flag : List.of("simulateDispatchError", "clinicalCorrectionRequested")) {
            if (v.containsKey(flag) && !(v.get(flag) instanceof Boolean)) throw new IllegalArgumentException("Invalid simulation flag");
        }
        int failures = remainingFailures(v);
        if (v.containsKey("delayReason") && (!(v.get("delayReason") instanceof String s) || s.length() > 500)) throw new IllegalArgumentException("Invalid delay reason");
        String at = now.toString();
        return switch (action) {
            case "record-draft-start" -> {
                // Map.of rejects nulls, so use a map that preserves the reset-to-null values.
                Map<String,Object> reset = new LinkedHashMap<>();
                reset.put("draftStartedAt", at);
                for (String field : List.of("draftCompletedAt", "approvedAt", "administrativeProcessedAt")) reset.put(field, null);
                for (String field : List.of("clinicalApproved", "recipientChecked", "administrativeDetailsChecked", "clinicalCorrectionRequested")) reset.put(field, false);
                yield complete(reset);
            }
            case "dispatch" -> dispatch(v, id, at, failures);
            case "reminder" -> Boolean.TRUE.equals(v.get("clinicalApproved")) && !Boolean.TRUE.equals(v.get("clinicalCorrectionRequested"))
                    ? complete(Map.of("reminderStatus", "SUPPRESSED_ALREADY_APPROVED"))
                    : complete(Map.of("lastReminderAt", at, "reminderStatus", "SIMULATED_AUTOMATED_NOTIFICATION"));
            case "escalate-one-month" -> complete(Map.of("oneMonthEscalatedAt", at, "oneMonthNotificationStatus", "SIMULATED_AUTOMATED_NOTIFICATION"));
            case "escalate-three-months" -> complete(Map.of("threeMonthEscalatedAt", at, "threeMonthNotificationStatus", "SIMULATED_AUTOMATED_NOTIFICATION"));
            default -> throw new IllegalArgumentException("Unsupported task type");
        };
    }

    private static int remainingFailures(Map<String,Object> v) {
        if (!v.containsKey("simulateTechnicalFailuresRemaining")) return 0;
        Object raw = v.get("simulateTechnicalFailuresRemaining");
        if (!(raw instanceof Number n) || !Double.isFinite(n.doubleValue()) || n.doubleValue() != Math.rint(n.doubleValue()) || n.doubleValue() < 0 || n.doubleValue() > 2) throw new IllegalArgumentException("Invalid technical failure count");
        return n.intValue();
    }

    private static Result dispatch(Map<String,Object> v, String id, String at, int failures) {
        if (!Boolean.TRUE.equals(v.get("clinicalApproved")) || !Boolean.TRUE.equals(v.get("recipientChecked")) || !Boolean.TRUE.equals(v.get("administrativeDetailsChecked")) || Boolean.TRUE.equals(v.get("clinicalCorrectionRequested"))) return reject("Clinical approval and both administrative checks are required");
        if (!(v.get("letterType") instanceof String letterType) || !Set.of("NEW_PATIENT", "FOLLOW_UP").contains(letterType)) return reject("Required letter type is incomplete");
        for (String key : CLINICAL_FIELDS) if (!(v.get(key) instanceof String text) || text.isBlank() || text.length() > 2000) return reject("Required structured letter content is incomplete");
        if (!(v.get("intendedRecipients") instanceof String text)) return reject("Consultant-selected recipient roles are required");
        List<String> roles = Arrays.stream(text.split(",", -1)).map(String::trim).toList();
        if (new HashSet<>(roles).size() != roles.size() || !RECIPIENTS.containsAll(roles)) return reject("Distinct synthetic recipient role codes are required");
        if (Boolean.TRUE.equals(v.get("simulateDispatchError"))) return reject("Simulated dispatch business rejection");
        if (failures > 0) return new Result(Action.TECHNICAL_FAILURE, Map.of("simulateTechnicalFailuresRemaining", failures - 1), "Simulated transient Clinic Letter transport failure");
        return complete(Map.of("dispatchStatus", "SIMULATED_SENT", "dispatchReference", "demo-" + id, "letterSentAt", at, "distributionMethod", "SIMULATED_LOCAL", "simulateTechnicalFailuresRemaining", 0));
    }
    private static Result complete(Map<String,Object> variables) {return new Result(Action.COMPLETE, variables, "");}
    private static Result reject(String message) {return new Result(Action.BUSINESS_ERROR, Map.of(), message);}
    private LetterLogic() {}
}
