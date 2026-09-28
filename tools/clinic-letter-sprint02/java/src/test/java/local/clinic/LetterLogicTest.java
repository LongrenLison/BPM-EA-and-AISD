package local.clinic;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class LetterLogicTest {
    private final Instant now = Instant.parse("2026-09-28T00:00:00Z");
    private Map<String,Object> valid() {
        Map<String,Object> v = new HashMap<>();
        v.put("clinicLetterId","DEMO-JAVA-001"); v.put("letterType","FOLLOW_UP");v.put("intendedRecipients","PATIENT,GP");
        for(String field:List.of("clinicalSummary","diagnosis","clinicalFindings","treatmentDecisions","followUpPlan","communicationInstructions"))v.put(field,"Synthetic text");
        for(String field:List.of("clinicalApproved","recipientChecked","administrativeDetailsChecked"))v.put(field,true);
        return v;
    }
    @Test void resetsApprovalOnReworkAndPreservesNullDates() {
        var r=LetterLogic.handle("record-draft-start",valid(),now);
        assertEquals(false,r.variables().get("clinicalApproved"));assertEquals(false,r.variables().get("recipientChecked"));
        assertTrue(r.variables().containsKey("approvedAt"));assertNull(r.variables().get("approvedAt"));assertEquals(now.toString(),r.variables().get("draftStartedAt"));
    }
    @Test void sendsOnlyCompleteApprovedSyntheticLetters() {
        var r=LetterLogic.handle("dispatch",valid(),now);assertEquals(LetterLogic.Action.COMPLETE,r.action());
        assertEquals("SIMULATED_SENT",r.variables().get("dispatchStatus"));assertEquals("demo-DEMO-JAVA-001",r.variables().get("dispatchReference"));
        for(String field:List.of("clinicalApproved","recipientChecked","administrativeDetailsChecked")) {var v=valid();v.put(field,false);assertEquals(LetterLogic.Action.BUSINESS_ERROR,LetterLogic.handle("dispatch",v,now).action());}
        var v=valid();v.put("clinicalCorrectionRequested",true);assertEquals(LetterLogic.Action.BUSINESS_ERROR,LetterLogic.handle("dispatch",v,now).action());
    }
    @Test void rejectsMissingContentAndAddressesAndDuplicateRecipients() {
        var v=valid();v.remove("diagnosis");assertEquals(LetterLogic.Action.BUSINESS_ERROR,LetterLogic.handle("dispatch",v,now).action());
        for(String roles:List.of("PATIENT,PATIENT","user@example.com","PATIENT,","")) {v=valid();v.put("intendedRecipients",roles);assertEquals(LetterLogic.Action.BUSINESS_ERROR,LetterLogic.handle("dispatch",v,now).action());}
    }
    @Test void separatesBusinessRejectionAndBoundedTechnicalRetry() {
        var v=valid();v.put("simulateDispatchError",true);assertEquals(LetterLogic.Action.BUSINESS_ERROR,LetterLogic.handle("dispatch",v,now).action());
        v=valid();v.put("simulateTechnicalFailuresRemaining",2);var r=LetterLogic.handle("dispatch",v,now);assertEquals(LetterLogic.Action.TECHNICAL_FAILURE,r.action());assertEquals(1,r.variables().get("simulateTechnicalFailuresRemaining"));
        v.put("simulateTechnicalFailuresRemaining",1);assertEquals(0,LetterLogic.handle("dispatch",v,now).variables().get("simulateTechnicalFailuresRemaining"));
        v.put("simulateTechnicalFailuresRemaining",0);assertEquals(LetterLogic.Action.COMPLETE,LetterLogic.handle("dispatch",v,now).action());
    }
    @Test void suppressesRemindersAfterApprovalAndRecordsBothEscalations() {
        var v=valid();assertEquals("SUPPRESSED_ALREADY_APPROVED",LetterLogic.handle("reminder",v,now).variables().get("reminderStatus"));
        v.put("clinicalApproved",false);assertEquals(now.toString(),LetterLogic.handle("reminder",v,now).variables().get("lastReminderAt"));
        assertEquals(now.toString(),LetterLogic.handle("escalate-one-month",v,now).variables().get("oneMonthEscalatedAt"));
        assertEquals(now.toString(),LetterLogic.handle("escalate-three-months",v,now).variables().get("threeMonthEscalatedAt"));
    }
    @Test void rejectsMalformedFlagsAndFailureCounts() {
        for(Object bad:List.of(-1,3,1.5,"2")) {var v=valid();v.put("simulateTechnicalFailuresRemaining",bad);assertThrows(IllegalArgumentException.class,()->LetterLogic.handle("dispatch",v,now));}
        var v=valid();v.put("simulateDispatchError","false");assertThrows(IllegalArgumentException.class,()->LetterLogic.handle("dispatch",v,now));
    }
}
