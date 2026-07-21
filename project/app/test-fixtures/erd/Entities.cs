using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ErDFixture;

public class OfficeAssignment
{
    [Key]
    public int InstructorID { get; set; }
    public string Location { get; set; } = string.Empty;
    public Instructor Instructor { get; set; } = null!;
}

public class Student
{
    [Key]
    public int ID { get; set; }
    public string LastName { get; set; } = string.Empty;
    public string FirstMidName { get; set; } = string.Empty;
    public DateTime EnrollmentDate { get; set; }
    public ICollection<Enrollment> Enrollments { get; set; } = new List<Enrollment>();
}

public class Instructor
{
    [Key]
    public int ID { get; set; }
    public string LastName { get; set; } = string.Empty;
    public string FirstMidName { get; set; } = string.Empty;
    public DateTime HireDate { get; set; }
    public OfficeAssignment? OfficeAssignment { get; set; }
    public ICollection<CourseAssignment> CourseAssignments { get; set; } = new List<CourseAssignment>();
    public ICollection<Department> Departments { get; set; } = new List<Department>();
}

public class Department
{
    [Key]
    public int DepartmentID { get; set; }
    public string Name { get; set; } = string.Empty;
    public decimal Budget { get; set; }
    public DateTime StartDate { get; set; }
    public int? InstructorID { get; set; }
    public Instructor? Administrator { get; set; }
    public ICollection<Course> Courses { get; set; } = new List<Course>();
}

public class Enrollment
{
    [Key]
    public int EnrollmentID { get; set; }
    public int CourseID { get; set; }
    public int StudentID { get; set; }
    public string? Grade { get; set; }
    public Course Course { get; set; } = null!;
    public Student Student { get; set; } = null!;
}

public class CourseAssignment
{
    public int CourseID { get; set; }
    public int InstructorID { get; set; }
    public Course Course { get; set; } = null!;
    public Instructor Instructor { get; set; } = null!;
}

public class Course
{
    [Key]
    public int CourseID { get; set; }
    public string Title { get; set; } = string.Empty;
    public int Credits { get; set; }
    public int DepartmentID { get; set; }
    public Department Department { get; set; } = null!;
    public ICollection<Enrollment> Enrollments { get; set; } = new List<Enrollment>();
    public ICollection<CourseAssignment> CourseAssignments { get; set; } = new List<CourseAssignment>();
}
