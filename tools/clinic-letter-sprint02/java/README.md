# Clinic Letter Java Worker

Requires JDK 21+ and Maven, or IntelliJ IDEA's Maven support. The project uses Camunda Java SDK 8.9.0 and checks the local engine is exactly 8.10.0-alpha5.

## IntelliJ IDEA

Open `pom.xml`, import Maven dependencies, and run `local.clinic.ClinicLetterWorker` with program arguments:

```text
--local-demo --minutes 30
```

Wait for `READY`, then start and complete the BPMN instance following the parent README. The worker handles service jobs only. It listens to normal and demo Clinic Letter job types; only the current demo model is included in the parent directory.

## Maven

From this `java` directory:

```text
mvn test
mvn package
java -jar target/clinic-letter-worker-1.0.0.jar --local-demo --minutes 30
```

Source files:

- `src/main/java/local/clinic/ClinicLetterWorker.java`: local client, worker registration and job commands.
- `src/main/java/local/clinic/LetterLogic.java`: variable validation, rework resets, simulated dispatch and notifications.
- `src/test/java/local/clinic/LetterLogicTest.java`: six logic test groups.

The `evidence` directory contains recorded local tests; reading it does not rerun engine scenarios. The old engine test launcher depended on local folders and is not shipped here. No compiled binaries, installed Camunda runtime, IDE configuration or credentials are included.
