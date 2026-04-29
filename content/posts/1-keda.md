+++
title = "Elevating Kubernetes Autoscaling: My Journey with KEDA"
date = "2026-04-28"
tags = ["Kubernetes", "KEDA", "SRE", "ArgoCD", "GitOps"]
author = "Davi A. Cândido"
+++

As an SRE/DevOps engineer, ensuring that the infrastructure can handle traffic spikes without wasting idle resources is a daily challenge. Recently, I decided to look beyond the traditional Horizontal Pod Autoscaler (HPA) and explore KEDA (Kubernetes Event-Driven Autoscaling).

This experience has changed how we think about elasticity in the cluster. Below is a summary of the implementation, the strategies adopted, and my vision for the future.

### Implementation

KEDA stands out for its architectural simplicity. It acts as an extended *Metrics Server*, meaning we don't need to change how Kubernetes understands scaling. We just need to enrich the data sources.
### Scaling Strategies

The traditional HPA, which is strictly based on CPU and memory, often fails in scenarios where a proactive approach is necessary. Migrating from these standard metrics to schedule-based strategies was a big game changer.

#### The Practical Case: `app-exemplo`

We replaced the old HPA configurations with ScaledObjects using cron triggers. We applied this logic to the `app-exemplo` service by mapping high-traffic windows and configuring KEDA to scale the application before the load arrived.

The configuration structure we used is shown below:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: app-exemplo-scaler
  namespace: dev
spec:
  scaleTargetRef:
    name: app-exemplo
  minReplicaCount: 2
  maxReplicaCount: 10
  triggers:
  - type: cron
    metadata:
      timezone: America/Sao_Paulo
      start: 0 8 * * 1-5
      end: 0 19 * * 1-5
      desiredReplicas: "6"
```

It's important to note that in the current example, `app-exemplo` has `desiredReplicas=6` only during business hours, the high-traffic period for this application. At all other times, including weekends, it maintains only two active pods.

This alone helps with the cost issue. However, in environments like development/staging, I thought, "Why not set the replicas to zero for even more cost reduction?"

#### Practical Case Continuation: Scale-to-Zero and FinOps Culture

In short, native Kubernetes HPA simply does not allow scaling to zero. This is where KEDA's strategic value for a FinOps culture becomes apparent.

In non-production environments, keeping pods running overnight or on weekends is akin to leaving the lights on in an empty office. With KEDA, we adjusted the `minReplicaCount` to `0`, effectively "turning off" the applications when the team is not working.

To implement this strategy successfully, we addressed two different realities in our infrastructure:

* **DEV Environment (Without ArgoCD):** Since the development pipeline is more fluid and does not use ArgoCD in the current workflow, the ScaledObjects manifests are applied directly to the pipelines. KEDA monitors the cluster and scales down replicas to zero after business hours, reducing computational consumption.

* **HOM Environment (With ArgoCD):** During homologation (staging), we uphold the principles of GitOps. ArgoCD manages the application of the KEDA manifests, ensuring that the environment automatically wakes up at the beginning of the day for necessary validations and "sleeps" (with zero replicas) at night and on weekends. This process is fully auditable via the repository.

The Scale-to-Zero configuration is very simple. It only requires changing the minimum limit and adjusting the window behavior in the Cron.

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: app-exemplo-scale-to-zero
  namespace: dev
spec:
  scaleTargetRef:
    name: app-exemplo
  minReplicaCount: 0
  maxReplicaCount: 5
  triggers:
  - type: cron
    metadata:
      timezone: America/Sao_Paulo
      start: 0 8 * * 1-5
      end: 0 19 * * 1-5
      desiredReplicas: "2"
```

This paradigm shift drastically reduced resource waste in the EKS nodes, complementing our other infrastructure optimizations, such as Cluster Node Autoscaling, perfectly.

#### The Safety Net: Implementing Fallback in KEDA

As part of our resilience strategy, we couldn't ignore Murphy's Law. What would happen if KEDA had trouble validating the trigger? For example, what if there was a failure in the external metrics API or temporary unavailability? To prevent the application from becoming unavailable or getting stuck at zero replicas during a read failure, we implemented KEDA's native *fallback* functionality.

The fallback ensures that if the trigger conditions cannot be validated after a certain number of failures, the deployment will assume a safe, predefined number of replicas. This maintains service stability until communication is restored.

Adding this to our `ScaledObject` was simple:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: app-exemplo-scale-to-zero
  namespace: dev
spec:
  scaleTargetRef:
    name: app-exemplo
  minReplicaCount: 0
  maxReplicaCount: 5
  fallback:
    failureThreshold: 3
    replicas: 2
  triggers:
  - type: cron
    # ..
```

### The Future: Exploring the Full Potential

The foundation is in place. However, I plan to explore the range of possibilities that KEDA offers in the coming sprints:

1. **Integration with AWS SQS:** Services that process queues can be made smarter by using scaling based on SQS volume (depth) rather than CPU usage for worker allocation.
2. **Prometheus-Based Triggers:** Since we already have advanced monitoring and alert provisioning in Grafana, the next step is to create `ScaledObjects` that read custom metrics from Prometheus. This will create a hyper-specific autoscaling mesh tailored to our business rules.

### Conclusion

The transition to KEDA changed our approach from reacting to bottlenecks to intelligent anticipation. When combined with structured provisioning via Terraform and release state control via ArgoCD, KEDA becomes a fundamental component of a modern, efficient Kubernetes infrastructure.