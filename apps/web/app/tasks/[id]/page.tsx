import { TaskClient } from '@/components/TaskClient'

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <TaskClient taskId={id} />
}
