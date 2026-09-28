package io.camunda.demo.enquiry;

import io.camunda.client.annotation.JobWorker;
import io.camunda.client.api.response.ActivatedJob;
import java.nio.file.Path;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Local demonstration worker for the standalone patient enquiry process. */
@Component
public class HospitalEnquiryWorker {
  private final HospitalDemoLedger ledger;

  public HospitalEnquiryWorker(
      @Value("${hospital.enquiry.ledger-directory:./data/enquiry-demo-ledger}") String directory) {
    this.ledger = new HospitalDemoLedger(Path.of(directory));
  }

  @JobWorker(type = "hospital.enquiry.initialize")
  public Map<String, Object> initialize(ActivatedJob job) {
    Map<String, Object> variables = job.getVariablesAsMap();
    Object patientId = variables.get("patientId");
    if (!(patientId instanceof String id) || id.isBlank()) {
      throw new IllegalArgumentException("patientId must be a non-empty string");
    }
    Object demoMode = variables.getOrDefault("demoMode", false);
    if (!(demoMode instanceof Boolean)) {
      throw new IllegalArgumentException("demoMode must be a JSON boolean");
    }
    String journeyId = value(variables, "journeyId", "J-" + job.getProcessInstanceKey());
    return Map.of("patientId", id, "journeyId", journeyId,
        "demoMode", demoMode, "adapterMode", "local-demonstration");
  }

  @JobWorker(type = "hospital.enquiry.audit.record")
  public Map<String, Object> recordAudit(ActivatedJob job) {
    Map<String, Object> variables = job.getVariablesAsMap();
    Object resolved = variables.get("enquiryResolved");
    if (!(resolved instanceof Boolean) || !((Boolean) resolved)) {
      throw new IllegalArgumentException("enquiryResolved must be JSON true before notification");
    }
    String receiptKey = "enquiry-audit:" + job.getKey();
    return ledger.once(receiptKey, () -> {
      Map<String, Object> receipt = new LinkedHashMap<>();
      receipt.put("auditRecorded", true);
      receipt.put("auditEventReference", "AUDIT-" + job.getKey());
      receipt.put("auditRecordedAt", Instant.now().toString());
      receipt.put("notificationMode", "local-demonstration");
      for (String field : List.of("journeyId", "patientId", "enquiryType", "enquiryPriority",
          "enquirySummary", "enquiryResponse", "responseStaffId", "enquiryHandlerId",
          "clinicalUrgency", "triageNotes", "triageClinicianId")) {
        if (variables.get(field) != null) receipt.put(field, variables.get(field).toString());
      }
      return receipt;
    });
  }

  private static String value(Map<String, Object> variables, String key, String fallback) {
    Object raw = variables.get(key);
    return raw instanceof String text && !text.isBlank() ? text : fallback;
  }
}
