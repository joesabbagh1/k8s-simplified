import { expect, test } from "vitest"
import { sentence } from "./text"

test("titles in capitals become sentence case, keeping acronyms and kinds", () => {
  expect(sentence("SAVED TO ETCD")).toBe("Saved to etcd")
  expect(sentence("AN IDENTITY, NOT AN IP")).toBe("An identity, not an IP")
  expect(sentence("KUBE-PROXY'S RULES")).toBe("kube-proxy's rules")
  expect(sentence("UN-DNAT")).toBe("Un-DNAT")
  expect(sentence("WAITING: CRASHLOOPBACKOFF")).toBe("Waiting: CrashLoopBackOff")
  expect(sentence("CREATE POD DB-0")).toBe("Create Pod db-0")
  expect(sentence("NDOTS:5 DECIDES")).toBe("ndots:5 decides")
})

test("titles already in mixed case are left alone", () => {
  expect(sentence("Deploy an app")).toBe("Deploy an app")
})

test("decoder titles keep protocol and kind spellings", () => {
  expect(sentence("HTTP/2 REQUEST")).toBe("HTTP/2 request")
  expect(sentence("HTTP/2 RESPONSE")).toBe("HTTP/2 response")
  expect(sentence("IPV4 + TCP · BEFORE → AFTER")).toBe("IPv4 + TCP · before → after")
  expect(sentence("BODY · ENDPOINTSLICE")).toBe("Body · EndpointSlice")
  expect(sentence("BODY · PERSISTENTVOLUMECLAIM")).toBe("Body · PersistentVolumeClaim")
  expect(sentence("POD SPEC · DNSCONFIG")).toBe("Pod spec · dnsConfig")
  expect(sentence("SOCKET · KQ9TW")).toBe("Socket · kq9tw")
  expect(sentence("ETH0 STAYED QUIET")).toBe("eth0 stayed quiet")
  expect(sentence("HEAP AT 1 S")).toBe("Heap at 1 s")
  expect(sentence("OUTER IPS")).toBe("Outer IPs")
})
