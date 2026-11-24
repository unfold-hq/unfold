---
type: added
---
Pod logs per Run work with a log store that names a line's pod under its own fields.

Set `observability.logsFields` to the names your log shipper writes, such as `k8s_namespace`, `k8s_pod` and `k8s_container`.
