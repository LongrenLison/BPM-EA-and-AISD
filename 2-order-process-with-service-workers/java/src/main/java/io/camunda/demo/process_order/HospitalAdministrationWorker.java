package io.camunda.demo.process_order;

import io.camunda.client.annotation.JobWorker;
import io.camunda.client.api.response.ActivatedJob;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Demonstration workers for 00-integrated-hospital-patient-administration.bpmn.
 *
 * The workers model external integrations deterministically so the whole process
 * can be demonstrated locally. Environment variables let a demonstrator choose
 * alternative gateway paths without changing BPMN or source code.
 */
@Component
public class HospitalAdministrationWorker {
  private static final Logger LOG = LoggerFactory.getLogger(HospitalAdministrationWorker.class);

  @JobWorker(type = "scheduling.search")
  public Map<String, Object> searchAppointment(ActivatedJob job) {
    boolean slotFound = environmentBoolean("DEMO_SLOT_FOUND", true);
    LOG.info("Scheduling search for job {} returned slotFound={}", job.getKey(), slotFound);
    return Map.of("slotFound", slotFound, "appointmentReference", "APT-" + job.getKey());
  }

  @JobWorker(type = "correspondence.dispatch")
  public Map<String, Object> dispatchAppointmentLetter(ActivatedJob job) {
    boolean withinTwoWeeks = environmentBoolean("DEMO_WITHIN_TWO_WEEKS", false);
    LOG.info("Correspondence dispatch for job {} returned appointmentWithinTwoWeeks={}", job.getKey(), withinTwoWeeks);
    return Map.of("appointmentWithinTwoWeeks", withinTwoWeeks, "appointmentLetterSent", true);
  }

  @JobWorker(type = "referral.request-information")
  public Map<String, Object> requestReferralInformation(ActivatedJob job) {
    LOG.info("Recorded missing-information request for job {}", job.getKey());
    return Map.of("informationRequestRecorded", true);
  }

  @JobWorker(type = "treatment.capacity-check")
  public Map<String, Object> checkTreatmentCapacity(ActivatedJob job) {
    boolean capacityAvailable = environmentBoolean("DEMO_TREATMENT_CAPACITY_AVAILABLE", true);
    LOG.info("Treatment capacity check for job {} returned {}", job.getKey(), capacityAvailable);
    return Map.of("treatmentCapacityAvailable", capacityAvailable);
  }

  @JobWorker(type = "funding.assess")
  public Map<String, Object> assessFunding(ActivatedJob job) {
    boolean advancePaymentRequired = environmentBoolean("DEMO_ADVANCE_PAYMENT_REQUIRED", false);
    LOG.info("Funding assessment for job {} returned advancePaymentRequired={}", job.getKey(), advancePaymentRequired);
    return Map.of("advancePaymentRequired", advancePaymentRequired);
  }

  @JobWorker(type = "payment.request")
  public Map<String, Object> requestPayment(ActivatedJob job) {
    String paymentStatus = paymentStatus();
    LOG.info("Payment request for job {} returned paymentStatus={}", job.getKey(), paymentStatus);
    return Map.of("paymentStatus", paymentStatus, "paymentReference", "PAY-" + job.getKey());
  }

  @JobWorker(type = "payment.status.request")
  public Map<String, Object> requestPaymentStatus(ActivatedJob job) {
    String paymentStatus = paymentStatus();
    LOG.info("Payment status check for job {} returned paymentStatus={}", job.getKey(), paymentStatus);
    return Map.of("paymentStatus", paymentStatus);
  }

  private boolean environmentBoolean(String variable, boolean defaultValue) {
    String value = System.getenv(variable);
    return value == null ? defaultValue : Boolean.parseBoolean(value);
  }

  private String paymentStatus() {
    String status = System.getenv().getOrDefault("DEMO_PAYMENT_STATUS", "completed");
    return switch (status) {
      case "completed", "investigate", "declined", "cancelled", "urgent" -> status;
      default -> throw new IllegalArgumentException("DEMO_PAYMENT_STATUS must be completed, investigate, declined, cancelled, or urgent");
    };
  }
}
