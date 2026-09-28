package local.clinic;

import io.camunda.client.CamundaClient;
import io.camunda.client.api.response.ActivatedJob;
import io.camunda.client.api.worker.JobClient;
import io.camunda.client.api.worker.JobWorker;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public final class ClinicLetterWorker {
    public static void main(String[] args) throws Exception {
        if ((args.length != 3 && args.length != 4) || !args[0].equals("--local-demo") || !args[1].equals("--minutes") || !args[2].matches("[1-9][0-9]*") || (args.length == 4 && !args[3].equals("--test-scope"))) throw new IllegalArgumentException("Use --local-demo --minutes 1..30 [--test-scope]");
        boolean testScope = args.length == 4;
        int minutes = Integer.parseInt(args[2]);
        if (minutes > 30) throw new IllegalArgumentException("Worker duration must be 1..30 minutes");
        CountDownLatch stop = new CountDownLatch(1);
        Thread shutdown = new Thread(() -> {stop.countDown(); try {Thread.sleep(1500);} catch (InterruptedException ignored) {Thread.currentThread().interrupt();}}, "clinic-worker-shutdown");
        Runtime.getRuntime().addShutdownHook(shutdown);
        List<JobWorker> workers = new ArrayList<>();
        try (CamundaClient client = CamundaClient.newClientBuilder()
                .applyEnvironmentVariableOverrides(false)
                .restAddress(URI.create("http://127.0.0.1:8080"))
                .grpcAddress(URI.create("http://127.0.0.1:26500"))
                .preferRestOverGrpc(true).defaultRequestTimeout(Duration.ofSeconds(10))
                .numJobWorkerExecutionThreads(2).build()) {
            var topology = client.newTopologyRequest().send().join();
            if (!"8.10.0-alpha5".equals(topology.getGatewayVersion())) throw new IllegalStateException("Expected Camunda 8.10.0-alpha5");
            for (boolean demo : List.of(false, true)) {
                String processId = demo ? "Process_ClinicLetterSprint02Demo" : "Process_ClinicLetterSprint02";
                String prefix = demo ? "clinic-letter.sprint02-demo." : "clinic-letter.sprint02.";
                if (testScope) {processId += "JavaVerification";prefix = prefix.substring(0, prefix.length()-1) + "-java-test.";}
                final String expectedProcess = processId;
                for (String action : LetterLogic.ACTIONS) {
                    workers.add(client.newWorker().jobType(prefix + action)
                            .handler((jobClient, job) -> handle(jobClient, job, expectedProcess, action))
                            .name("clinic-letter-java-simulated").maxJobsActive(1)
                            .timeout(Duration.ofSeconds(30)).pollInterval(Duration.ofMillis(300))
                            .requestTimeout(Duration.ofSeconds(2)).streamEnabled(false)
                            .jobExceptionHandler(context -> System.err.println("COMMAND_ERROR: outcome uncertain; no automatic failure write"))
                            .open());
                }
            }
            System.out.println("READY: Clinic Letter Java Worker; Camunda 8.10.0-alpha5; 10 job types; simulated only; minutes=" + minutes + "; testScope=" + testScope);
            stop.await(minutes, TimeUnit.MINUTES);
        } finally {
            for (JobWorker worker : workers) worker.close();
            try {Runtime.getRuntime().removeShutdownHook(shutdown);} catch (IllegalStateException ignored) {}
            System.out.println("STOPPED: Clinic Letter Java Worker");
        }
    }

    private static void handle(JobClient client, ActivatedJob job, String expectedProcess, String action) {
        if (!expectedProcess.equals(job.getBpmnProcessId())) {
            System.err.println("IGNORED foreign process job=" + job.getKey());
            return; // Activation expires; never complete or fail unrelated jobs.
        }
        LetterLogic.Result result;
        try {result = LetterLogic.handle(action, job.getVariablesAsMap(), Instant.now());}
        catch (IllegalArgumentException invalid) {
            // Invalid input requires correction; logs contain no clinical text or contacts.
            client.newFailCommand(job.getKey()).retries(0).errorMessage("Invalid synthetic Clinic Letter variables; correct input").send().join();
            System.err.println("INVALID_INPUT job=" + job.getKey()); return;
        }
        // Keep command errors outside the validation catch: an uncertain completion
        // must not trigger a second failure write or duplicate simulated dispatch.
        switch (result.action()) {
            case COMPLETE -> client.newCompleteCommand(job.getKey()).variables(result.variables()).send().join();
            case BUSINESS_ERROR -> client.newThrowErrorCommand(job.getKey()).errorCode(LetterLogic.ERROR_CODE).errorMessage(result.message()).send().join();
            case TECHNICAL_FAILURE -> client.newFailCommand(job.getKey()).retries(Math.max(0, job.getRetries() - 1))
                    .retryBackoff(Duration.ofSeconds(1)).errorMessage(result.message()).variables(result.variables()).send().join();
        }
        System.out.println("ACK instance=" + job.getProcessInstanceKey() + " job=" + job.getKey() + " task=" + action + " result=" + result.action());
    }
    private ClinicLetterWorker() {}
}
