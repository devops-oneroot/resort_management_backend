const DailyTask = require('../models/DailyTask');

function normalizeDepartment(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

/**
 * Complete a daily task with only the start image (no end image).
 * @param {string} taskId Mongo id string
 */
async function completeDailyTaskById(req, res, taskId) {
  try {
    const id = String(taskId || '').trim();
    if (!id) {
      return res.status(400).json({ message: 'taskId is required' });
    }

    const task = await DailyTask.findById(id);
    if (!task) {
      return res.status(404).json({ message: 'Daily task not found' });
    }
    if (task.status === 'completed') {
      return res.status(400).json({ message: 'Daily task already completed' });
    }

    const isTaskOwner = task.employee.toString() === req.user._id.toString();
    const isMainAdmin = req.user.role === 'admin' && req.user.isMainAdmin;
    if (!isTaskOwner && !isMainAdmin) {
      return res.status(403).json({ message: 'Not allowed to complete this daily task' });
    }

    if (req.user.role === 'admin' && !req.user.isMainAdmin) {
      const sameDept = normalizeDepartment(req.user.department) === normalizeDepartment(task.department);
      if (!sameDept) {
        return res.status(403).json({ message: 'Department admin can access only their department tasks' });
      }
    }

    task.status = 'completed';
    task.endTime = new Date();
    const updated = await task.save();
    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to complete daily task' });
  }
}

/** POST /api/daily-tasks/complete-one { taskId } — registered on dailyTaskRoutes router. */
async function dailyTaskCompleteOnePost(req, res) {
  const taskId = String(req.body?.taskId || '').trim();
  if (!taskId) {
    return res.status(400).json({ message: 'taskId is required' });
  }
  return completeDailyTaskById(req, res, taskId);
}

module.exports = dailyTaskCompleteOnePost;
module.exports.completeDailyTaskById = completeDailyTaskById;
