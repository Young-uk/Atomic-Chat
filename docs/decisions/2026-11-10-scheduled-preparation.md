# Prepare scheduled text before delivery

Begin text-only reminder generation up to five minutes before the occurrence. Persist the result as prepared; the durable delivery outbox hides it until due. Delivery polling transitions prepared one-shots to completed. A failed early attempt waits until due for one fallback, and the same in-flight generation is never duplicated.

Due ticks publish a preparing notice while generation is still running. The timer continues polling due notices even when its single inference worker is occupied. An undelivered notice is superseded by the final result. Cancellation suppresses undelivered prepared results. Recurrence advances from the later of the occurrence and the current clock, so early completion cannot reschedule the same cron occurrence. Missed work is not silently replayed after restart. Prompts use the delivery timestamp and original timezone rather than treating preparation time as delivery time.
