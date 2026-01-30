import { prisma } from '@/lib/prisma'
import { ExpenseFormValues, GroupFormValues } from '@/lib/schemas'
import {
  ActivityType,
  Expense,
  RecurrenceRule,
  RecurringExpenseLink,
} from '@prisma/client'
import { nanoid } from 'nanoid'

export function randomId() {
  return nanoid()
}

export async function createGroup(groupFormValues: GroupFormValues) {
  return prisma.group.create({
    data: {
      id: randomId(),
      name: groupFormValues.name,
      information: groupFormValues.information,
      currency: groupFormValues.currency,
      currencyCode: groupFormValues.currencyCode,
      // Password protection (Issue #2)
      passwordSalt: groupFormValues.passwordSalt,
      passwordHint: groupFormValues.passwordHint,
      participants: {
        createMany: {
          data: groupFormValues.participants.map(({ name }) => ({
            id: randomId(),
            name,
          })),
        },
      },
    },
    include: { participants: true },
  })
}

export async function createExpense(
  expenseFormValues: ExpenseFormValues,
  groupId: string,
  participantId?: string,
): Promise<Expense> {
  const group = await getGroup(groupId)
  if (!group) throw new Error(`Invalid group ID: ${groupId}`)

  for (const participant of [
    expenseFormValues.paidBy,
    ...expenseFormValues.paidFor.map((p) => p.participant),
  ]) {
    if (!group.participants.some((p) => p.id === participant))
      throw new Error(`Invalid participant ID: ${participant}`)
  }

  const expenseId = randomId()
  const isCreateRecurrence =
    expenseFormValues.recurrenceRule !== RecurrenceRule.NONE
  const recurringExpenseLinkPayload = createPayloadForNewRecurringExpenseLink(
    expenseFormValues.recurrenceRule as RecurrenceRule,
    expenseFormValues.expenseDate,
    groupId,
  )

  // Use transaction to ensure activity log and expense creation are atomic (Issue #79)
  return prisma.$transaction(async (tx) => {
    await tx.activity.create({
      data: {
        id: randomId(),
        groupId,
        activityType: ActivityType.CREATE_EXPENSE,
        participantId,
        expenseId,
        data: expenseFormValues.title,
      },
    })

    return tx.expense.create({
      data: {
        id: expenseId,
        groupId,
        expenseDate: expenseFormValues.expenseDate,
        categoryId: String(expenseFormValues.category), // Convert to string (can be encrypted string or number)
        amount: String(expenseFormValues.amount), // Convert to string for DB storage
        originalAmount:
          expenseFormValues.originalAmount !== undefined
            ? String(expenseFormValues.originalAmount)
            : null,
        originalCurrency: expenseFormValues.originalCurrency,
        conversionRate: expenseFormValues.conversionRate,
        title: expenseFormValues.title,
        paidById: expenseFormValues.paidBy,
        splitMode: expenseFormValues.splitMode,
        recurrenceRule: expenseFormValues.recurrenceRule,
        recurringExpenseLink: {
          ...(isCreateRecurrence
            ? {
                create: recurringExpenseLinkPayload,
              }
            : {}),
        },
        paidFor: {
          createMany: {
            data: expenseFormValues.paidFor.map((paidFor) => ({
              participantId: paidFor.participant,
              shares: String(paidFor.shares), // Convert to string for DB storage
            })),
          },
        },
        isReimbursement: expenseFormValues.isReimbursement,
        documents: {
          createMany: {
            data: expenseFormValues.documents.map((doc) => ({
              id: randomId(),
              url: doc.url,
              width: doc.width,
              height: doc.height,
            })),
          },
        },
        notes: expenseFormValues.notes,
      },
    })
  })
}

export async function deleteExpense(
  groupId: string,
  expenseId: string,
  participantId?: string,
) {
  // Verify expense exists and belongs to the group before deleting (Issue #47)
  const existingExpense = await getExpense(groupId, expenseId)
  if (!existingExpense) {
    throw new Error('Expense not found or access denied')
  }

  // Use transaction to ensure activity log and expense deletion are atomic (Issue #79)
  await prisma.$transaction(async (tx) => {
    await tx.activity.create({
      data: {
        id: randomId(),
        groupId,
        activityType: ActivityType.DELETE_EXPENSE,
        participantId,
        expenseId,
        data: existingExpense.title,
      },
    })

    await tx.expense.delete({
      where: { id: expenseId },
      include: { paidFor: true, paidBy: true },
    })
  })
}

export async function getGroupExpensesParticipants(groupId: string) {
  const expenses = await getGroupExpenses(groupId)
  return Array.from(
    new Set(
      expenses.flatMap((e) => [
        e.paidBy.id,
        ...e.paidFor.map((pf) => pf.participant.id),
      ]),
    ),
  )
}

export async function getGroups(groupIds: string[]) {
  return (
    await prisma.group.findMany({
      where: { id: { in: groupIds } },
      include: { _count: { select: { participants: true } } },
    })
  ).map((group) => ({
    ...group,
    createdAt: group.createdAt.toISOString(),
    deletedAt: group.deletedAt?.toISOString() ?? null,
  }))
}

export async function updateExpense(
  groupId: string,
  expenseId: string,
  expenseFormValues: ExpenseFormValues,
  participantId?: string,
) {
  const group = await getGroup(groupId)
  if (!group) throw new Error(`Invalid group ID: ${groupId}`)

  const existingExpense = await getExpense(groupId, expenseId)
  if (!existingExpense) throw new Error(`Invalid expense ID: ${expenseId}`)

  for (const participant of [
    expenseFormValues.paidBy,
    ...expenseFormValues.paidFor.map((p) => p.participant),
  ]) {
    if (!group.participants.some((p) => p.id === participant))
      throw new Error(`Invalid participant ID: ${participant}`)
  }

  const isDeleteRecurrenceExpenseLink =
    existingExpense.recurrenceRule !== RecurrenceRule.NONE &&
    expenseFormValues.recurrenceRule === RecurrenceRule.NONE &&
    // Delete the existing RecurrenceExpenseLink only if it has not been acted upon yet
    existingExpense.recurringExpenseLink?.nextExpenseCreatedAt === null

  const isUpdateRecurrenceExpenseLink =
    existingExpense.recurrenceRule !== expenseFormValues.recurrenceRule &&
    // Update the exisiting RecurrenceExpenseLink only if it has not been acted upon yet
    existingExpense.recurringExpenseLink?.nextExpenseCreatedAt === null
  const isCreateRecurrenceExpenseLink =
    existingExpense.recurrenceRule === RecurrenceRule.NONE &&
    expenseFormValues.recurrenceRule !== RecurrenceRule.NONE &&
    // Create a new RecurrenceExpenseLink only if one does not already exist for the expense
    existingExpense.recurringExpenseLink === null

  const newRecurringExpenseLink = createPayloadForNewRecurringExpenseLink(
    expenseFormValues.recurrenceRule as RecurrenceRule,
    expenseFormValues.expenseDate,
    groupId,
  )

  const updatedRecurrenceExpenseLinkNextExpenseDate = calculateNextDate(
    expenseFormValues.recurrenceRule as RecurrenceRule,
    existingExpense.expenseDate,
  )

  // Use transaction to ensure activity log and expense update are atomic (Issue #79)
  return prisma.$transaction(async (tx) => {
    await tx.activity.create({
      data: {
        id: randomId(),
        groupId,
        activityType: ActivityType.UPDATE_EXPENSE,
        participantId,
        expenseId,
        data: expenseFormValues.title,
      },
    })

    return tx.expense.update({
      where: { id: expenseId },
      data: {
        expenseDate: expenseFormValues.expenseDate,
        amount: String(expenseFormValues.amount), // Convert to string for DB storage
        originalAmount:
          expenseFormValues.originalAmount !== undefined
            ? String(expenseFormValues.originalAmount)
            : null,
        originalCurrency: expenseFormValues.originalCurrency,
        conversionRate: expenseFormValues.conversionRate,
        title: expenseFormValues.title,
        categoryId: String(expenseFormValues.category), // Convert to string (can be encrypted string or number)
        paidById: expenseFormValues.paidBy,
        splitMode: expenseFormValues.splitMode,
        recurrenceRule: expenseFormValues.recurrenceRule,
        paidFor: {
          create: expenseFormValues.paidFor
            .filter(
              (p) =>
                !existingExpense.paidFor.some(
                  (pp) => pp.participantId === p.participant,
                ),
            )
            .map((paidFor) => ({
              participantId: paidFor.participant,
              shares: String(paidFor.shares), // Convert to string for DB storage
            })),
          update: expenseFormValues.paidFor.map((paidFor) => ({
            where: {
              expenseId_participantId: {
                expenseId,
                participantId: paidFor.participant,
              },
            },
            data: {
              shares: String(paidFor.shares), // Convert to string for DB storage
            },
          })),
          deleteMany: existingExpense.paidFor.filter(
            (paidFor) =>
              !expenseFormValues.paidFor.some(
                (pf) => pf.participant === paidFor.participantId,
              ),
          ),
        },
        recurringExpenseLink: {
          ...(isCreateRecurrenceExpenseLink
            ? {
                create: newRecurringExpenseLink,
              }
            : {}),
          ...(isUpdateRecurrenceExpenseLink
            ? {
                update: {
                  nextExpenseDate: updatedRecurrenceExpenseLinkNextExpenseDate,
                },
              }
            : {}),
          delete: isDeleteRecurrenceExpenseLink,
        },
        isReimbursement: expenseFormValues.isReimbursement,
        documents: {
          connectOrCreate: expenseFormValues.documents.map((doc) => ({
            create: doc,
            where: { id: doc.id },
          })),
          deleteMany: existingExpense.documents
            .filter(
              (existingDoc) =>
                !expenseFormValues.documents.some(
                  (doc) => doc.id === existingDoc.id,
                ),
            )
            .map((doc) => ({
              id: doc.id,
            })),
        },
        notes: expenseFormValues.notes,
      },
    })
  })
}

export async function deleteGroup(groupId: string) {
  const existingGroup = await getGroup(groupId)
  if (!existingGroup) throw new Error('Invalid group ID')

  return prisma.group.update({
    where: { id: groupId },
    data: {
      deletedAt: new Date(),
    },
  })
}

export async function restoreGroup(groupId: string) {
  const existingGroup = await prisma.group.findUnique({
    where: { id: groupId },
  })
  if (!existingGroup) throw new Error('Invalid group ID')
  if (!existingGroup.deletedAt) throw new Error('Group is not deleted')

  return prisma.group.update({
    where: { id: groupId },
    data: {
      deletedAt: null,
    },
  })
}

export async function permanentlyDeleteGroup(groupId: string) {
  const existingGroup = await prisma.group.findUnique({
    where: { id: groupId },
  })
  if (!existingGroup) throw new Error('Invalid group ID')

  // Cascade delete will handle related records
  return prisma.group.delete({
    where: { id: groupId },
  })
}

export async function updateGroup(
  groupId: string,
  groupFormValues: GroupFormValues,
  participantId?: string,
) {
  const existingGroup = await getGroup(groupId)
  if (!existingGroup) throw new Error('Invalid group ID')

  // Issue #81: Check for participants being deleted
  const participantsToDelete = existingGroup.participants
    .filter((p) => !groupFormValues.participants.some((p2) => p2.id === p.id))
    .map((p) => p.id)

  if (participantsToDelete.length > 0) {
    // Check if any expenses reference these participants as paidBy
    // Due to cascade delete, removing these participants would delete their expenses
    const expensesWithDeletedPayer = await prisma.expense.findMany({
      where: {
        groupId,
        paidById: { in: participantsToDelete },
      },
      select: {
        id: true,
        title: true,
        paidBy: { select: { name: true } },
      },
    })

    if (expensesWithDeletedPayer.length > 0) {
      const participantNames = expensesWithDeletedPayer
        .map((e) => e.paidBy.name)
        .filter((name, index, arr) => arr.indexOf(name) === index)
        .join(', ')
      throw new Error(
        `Cannot delete participants with existing expenses. ` +
          `The following participants have paid for expenses: ${participantNames}. ` +
          `Please reassign or delete their expenses first.`,
      )
    }
  }

  await logActivity(groupId, ActivityType.UPDATE_GROUP, { participantId })

  return prisma.group.update({
    where: { id: groupId },
    data: {
      name: groupFormValues.name,
      information: groupFormValues.information,
      currency: groupFormValues.currency,
      currencyCode: groupFormValues.currencyCode,
      participants: {
        deleteMany: existingGroup.participants.filter(
          (p) => !groupFormValues.participants.some((p2) => p2.id === p.id),
        ),
        updateMany: groupFormValues.participants
          .filter((participant) => participant.id !== undefined)
          .map((participant) => ({
            where: { id: participant.id },
            data: {
              name: participant.name,
            },
          })),
        createMany: {
          data: groupFormValues.participants
            .filter((participant) => participant.id === undefined)
            .map((participant) => ({
              id: randomId(),
              name: participant.name,
            })),
        },
      },
    },
  })
}

export async function getGroup(groupId: string) {
  return prisma.group.findUnique({
    where: { id: groupId },
    include: { participants: true },
  })
}

export async function getCategories() {
  return prisma.category.findMany()
}

export async function getGroupExpenses(
  groupId: string,
  options?: { offset?: number; length?: number; filter?: string },
) {
  await createRecurringExpenses()

  return prisma.expense.findMany({
    select: {
      amount: true,
      categoryId: true,
      createdAt: true,
      expenseDate: true,
      id: true,
      isReimbursement: true,
      paidBy: { select: { id: true, name: true } },
      paidFor: {
        select: {
          participant: { select: { id: true, name: true } },
          shares: true,
        },
      },
      splitMode: true,
      recurrenceRule: true,
      title: true,
      _count: { select: { documents: true } },
    },
    where: {
      groupId,
      title: options?.filter
        ? { contains: options.filter, mode: 'insensitive' }
        : undefined,
    },
    orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
    skip: options && options.offset,
    take: options && options.length,
  })
}

export async function getGroupExpenseCount(groupId: string) {
  return prisma.expense.count({ where: { groupId } })
}

export async function getExpense(groupId: string, expenseId: string) {
  // Validate both expenseId AND groupId to prevent accessing expenses from other groups (Issue #47)
  return prisma.expense.findFirst({
    where: {
      id: expenseId,
      groupId: groupId,
    },
    include: {
      paidBy: true,
      paidFor: true,
      // categoryId is a scalar field (encrypted string), not a relation - automatically included
      documents: true,
      recurringExpenseLink: true,
    },
  })
}

export async function getActivities(
  groupId: string,
  options?: { offset?: number; length?: number },
) {
  const activities = await prisma.activity.findMany({
    where: { groupId },
    orderBy: [{ time: 'desc' }],
    skip: options?.offset,
    take: options?.length,
  })

  const expenseIds = activities
    .map((activity) => activity.expenseId)
    .filter(Boolean)
  const expenses = await prisma.expense.findMany({
    where: {
      groupId,
      id: { in: expenseIds },
    },
  })

  return activities.map((activity) => ({
    ...activity,
    expense:
      activity.expenseId !== null
        ? expenses.find((expense) => expense.id === activity.expenseId)
        : undefined,
  }))
}

export async function logActivity(
  groupId: string,
  activityType: ActivityType,
  extra?: { participantId?: string; expenseId?: string; data?: string },
) {
  return prisma.activity.create({
    data: {
      id: randomId(),
      groupId,
      activityType,
      ...extra,
    },
  })
}

async function createRecurringExpenses() {
  const localDate = new Date() // Current local date
  const utcDateFromLocal = new Date(
    Date.UTC(
      localDate.getUTCFullYear(),
      localDate.getUTCMonth(),
      localDate.getUTCDate(),
      // More precision beyond date is required to ensure that recurring Expenses are created within <most precises unit> of when expected
      localDate.getUTCHours(),
      localDate.getUTCMinutes(),
    ),
  )

  const recurringExpenseLinksWithExpensesToCreate =
    await prisma.recurringExpenseLink.findMany({
      where: {
        nextExpenseCreatedAt: null,
        nextExpenseDate: {
          lte: utcDateFromLocal,
        },
      },
      include: {
        currentFrameExpense: {
          include: {
            paidBy: true,
            paidFor: true,
            // categoryId is a scalar field, automatically included
            documents: true,
          },
        },
      },
    })

  for (const recurringExpenseLink of recurringExpenseLinksWithExpensesToCreate) {
    let newExpenseDate = recurringExpenseLink.nextExpenseDate

    let currentExpenseRecord = recurringExpenseLink.currentFrameExpense
    let currentReccuringExpenseLinkId = recurringExpenseLink.id

    while (newExpenseDate < utcDateFromLocal) {
      const newExpenseId = randomId()
      const newRecurringExpenseLinkId = randomId()

      const newRecurringExpenseNextExpenseDate = calculateNextDate(
        currentExpenseRecord.recurrenceRule as RecurrenceRule,
        newExpenseDate,
      )

      const {
        // category relation removed for E2EE (Issue #19) - categoryId is now a scalar field
        paidBy,
        paidFor,
        documents,
        ...destructeredCurrentExpenseRecord
      } = currentExpenseRecord

      // Use a transacton to ensure that the only one expense is created for the RecurringExpenseLink
      // just in case two clients are processing the same RecurringExpenseLink at the same time
      const newExpense = await prisma
        .$transaction(async (transaction) => {
          const newExpense = await transaction.expense.create({
            data: {
              ...destructeredCurrentExpenseRecord,
              categoryId: currentExpenseRecord.categoryId,
              paidById: currentExpenseRecord.paidById,
              paidFor: {
                createMany: {
                  data: currentExpenseRecord.paidFor.map((paidFor) => ({
                    participantId: paidFor.participantId,
                    shares: paidFor.shares,
                  })),
                },
              },
              documents: {
                connect: currentExpenseRecord.documents.map(
                  (documentRecord) => ({
                    id: documentRecord.id,
                  }),
                ),
              },
              id: newExpenseId,
              expenseDate: newExpenseDate,
              recurringExpenseLink: {
                create: {
                  groupId: currentExpenseRecord.groupId,
                  id: newRecurringExpenseLinkId,
                  nextExpenseDate: newRecurringExpenseNextExpenseDate,
                },
              },
            },
            // Ensure that the same information is available on the returned record that was created
            include: {
              paidFor: true,
              documents: true,
              // categoryId is a scalar field, automatically included
              paidBy: true,
            },
          })

          // Mark the RecurringExpenseLink as being "completed" since the new Expense was created
          // if an expense hasn't been created for this RecurringExpenseLink yet
          await transaction.recurringExpenseLink.update({
            where: {
              id: currentReccuringExpenseLinkId,
              nextExpenseCreatedAt: null,
            },
            data: {
              nextExpenseCreatedAt: newExpense.createdAt,
            },
          })

          return newExpense
        })
        .catch(() => {
          console.error(
            'Failed to created recurringExpense for expenseId: %s',
            currentExpenseRecord.id,
          )
          return null
        })

      // If the new expense failed to be created, break out of the while-loop
      if (newExpense === null) break

      // Set the values for the next iteration of the for-loop in case multiple recurring Expenses need to be created
      currentExpenseRecord = newExpense
      currentReccuringExpenseLinkId = newRecurringExpenseLinkId
      newExpenseDate = newRecurringExpenseNextExpenseDate
    }
  }
}

function createPayloadForNewRecurringExpenseLink(
  recurrenceRule: RecurrenceRule,
  priorDateToNextRecurrence: Date,
  groupId: String,
): RecurringExpenseLink {
  const nextExpenseDate = calculateNextDate(
    recurrenceRule,
    priorDateToNextRecurrence,
  )

  const recurringExpenseLinkId = randomId()
  const recurringExpenseLinkPayload = {
    id: recurringExpenseLinkId,
    groupId: groupId,
    nextExpenseDate: nextExpenseDate,
  }

  return recurringExpenseLinkPayload as RecurringExpenseLink
}

// TODO: Modify this function to use a more comprehensive recurrence Rule library like rrule (https://github.com/jkbrzt/rrule)
//
// Current limitations:
// - If a date is intended to be repeated monthly on the 29th, 30th or 31st, it will change to repeating on the smallest
// date that the reccurence has encountered. Ex. If a recurrence is created for Jan 31st on 2025, the recurring expense
// will be created for Feb 28th, March 28, etc. until it is cancelled or fixed
function calculateNextDate(
  recurrenceRule: RecurrenceRule,
  priorDateToNextRecurrence: Date,
): Date {
  const nextDate = new Date(priorDateToNextRecurrence)
  switch (recurrenceRule) {
    case RecurrenceRule.DAILY:
      nextDate.setUTCDate(nextDate.getUTCDate() + 1)
      break
    case RecurrenceRule.WEEKLY:
      nextDate.setUTCDate(nextDate.getUTCDate() + 7)
      break
    case RecurrenceRule.MONTHLY:
      const nextYear = nextDate.getUTCFullYear()
      const nextMonth = nextDate.getUTCMonth() + 1
      let nextDay = nextDate.getUTCDate()

      // Reduce the next day until it is within the direct next month
      while (!isDateInNextMonth(nextYear, nextMonth, nextDay)) {
        nextDay -= 1
      }
      nextDate.setUTCMonth(nextMonth, nextDay)
      break
  }

  return nextDate
}

function isDateInNextMonth(
  utcYear: number,
  utcMonth: number,
  utcDate: number,
): Boolean {
  const testDate = new Date(Date.UTC(utcYear, utcMonth, utcDate))

  // We're not concerned if the year or month changes. We only want to make sure that the date is our target date
  if (testDate.getUTCDate() !== utcDate) {
    return false
  }

  return true
}
